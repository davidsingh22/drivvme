import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, RefreshCw, Search, Clock, CheckCircle, XCircle, AlertTriangle, Users } from "lucide-react";
import { format } from "date-fns";

interface RideRequest {
  id: string;
  rider_id: string;
  rider_name: string | null;
  ride_id: string | null;
  pickup_text: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_text: string;
  dropoff_lat: number;
  dropoff_lng: number;
  estimated_fare: number | null;
  estimated_minutes: number | null;
  status: string;
  driver_id: string | null;
  driver_name: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_OPTIONS = [
  "ALL", "REQUESTED", "SEARCHING_DRIVER", "OFFER_SENT", "DRIVER_ACCEPTED",
  "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "RIDE_STARTED", "RIDE_COMPLETED",
  "CANCELLED_BY_RIDER", "CANCELLED_BY_DRIVER", "EXPIRED"
];

const statusColor = (status: string) => {
  switch (status) {
    case "REQUESTED": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "SEARCHING_DRIVER": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "OFFER_SENT": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "DRIVER_ACCEPTED": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "DRIVER_EN_ROUTE": return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
    case "DRIVER_ARRIVED": return "bg-teal-500/20 text-teal-400 border-teal-500/30";
    case "RIDE_STARTED": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    case "RIDE_COMPLETED": return "bg-green-500/20 text-green-400 border-green-500/30";
    case "CANCELLED_BY_RIDER":
    case "CANCELLED_BY_DRIVER": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "EXPIRED": return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    default: return "bg-muted text-muted-foreground";
  }
};

const AdminRideRequests = () => {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<RideRequest | null>(null);

  // Counters
  const [last5Min, setLast5Min] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [acceptedToday, setAcceptedToday] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  const [cancelledToday, setCancelledToday] = useState(0);

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    if (!isAdmin) { navigate("/"); toast({ title: "Access denied", variant: "destructive" }); return; }
  }, [user, isAdmin]);

  const fetchRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from("ride_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) { console.error(error); return; }
    const rows = (data || []) as unknown as RideRequest[];
    setRequests(rows);

    // Compute counters
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    setLast5Min(rows.filter(r => new Date(r.created_at) >= fiveMinAgo).length);
    setPendingCount(rows.filter(r => ["REQUESTED", "SEARCHING_DRIVER", "OFFER_SENT"].includes(r.status)).length);
    setAcceptedToday(rows.filter(r => r.status === "DRIVER_ACCEPTED" && new Date(r.created_at) >= todayStart).length);
    setCompletedToday(rows.filter(r => r.status === "RIDE_COMPLETED" && new Date(r.created_at) >= todayStart).length);
    setCancelledToday(rows.filter(r => ["CANCELLED_BY_RIDER", "CANCELLED_BY_DRIVER"].includes(r.status) && new Date(r.created_at) >= todayStart).length);

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("ride_requests_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_requests" }, () => {
        fetchRequests();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchRequests]);

  const filtered = requests.filter(r => {
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!r.rider_id.toLowerCase().includes(q) && !(r.rider_name || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground">Riders Booking a Ride</h1>
          <Button variant="outline" size="sm" onClick={fetchRequests} className="ml-auto">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Counter Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-blue-400" />
            <div><p className="text-xs text-muted-foreground">Last 5 min</p><p className="text-xl font-bold">{last5Min}</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
            <div><p className="text-xs text-muted-foreground">Pending</p><p className="text-xl font-bold">{pendingCount}</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <Users className="h-5 w-5 text-emerald-400" />
            <div><p className="text-xs text-muted-foreground">Accepted today</p><p className="text-xl font-bold">{acceptedToday}</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-400" />
            <div><p className="text-xs text-muted-foreground">Completed today</p><p className="text-xl font-bold">{completedToday}</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-400" />
            <div><p className="text-xs text-muted-foreground">Cancelled today</p><p className="text-xl font-bold">{cancelledToday}</p></div>
          </CardContent></Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by rider ID or name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => (
                <SelectItem key={s} value={s}>{s === "ALL" ? "All statuses" : s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground animate-pulse">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No ride requests found.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rider</TableHead>
                    <TableHead>Pickup → Dropoff</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/60"
                      onClick={() => setSelectedRequest(r)}
                    >
                      <TableCell>
                        <div className="text-sm font-medium">{r.rider_name || "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate max-w-[120px]">{r.rider_id.slice(0, 8)}...</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm truncate max-w-[200px]">{r.pickup_text}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">→ {r.dropoff_text}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColor(r.status)}>
                          {r.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{r.driver_name || r.driver_id?.slice(0, 8) || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(r.created_at), "HH:mm:ss")}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(r.updated_at), "HH:mm:ss")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Detail Modal */}
        <Dialog open={!!selectedRequest} onOpenChange={open => !open && setSelectedRequest(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Ride Request Detail</DialogTitle>
            </DialogHeader>
            {selectedRequest && (
              <div className="space-y-4">
                {/* Status big badge */}
                <div className="flex justify-center">
                  <Badge variant="outline" className={`text-lg px-4 py-2 ${statusColor(selectedRequest.status)}`}>
                    {selectedRequest.status.replace(/_/g, " ")}
                  </Badge>
                </div>

                {/* Rider */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Rider</p>
                  <p className="font-medium">{selectedRequest.rider_name || "Unknown"}</p>
                  <p className="text-xs font-mono text-muted-foreground">{selectedRequest.rider_id}</p>
                </div>

                {/* Pickup / Dropoff */}
                <div className="grid grid-cols-1 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground uppercase">Pickup</p>
                    <p className="text-sm font-medium">{selectedRequest.pickup_text}</p>
                    <p className="text-xs text-muted-foreground">{selectedRequest.pickup_lat.toFixed(5)}, {selectedRequest.pickup_lng.toFixed(5)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground uppercase">Dropoff</p>
                    <p className="text-sm font-medium">{selectedRequest.dropoff_text}</p>
                    <p className="text-xs text-muted-foreground">{selectedRequest.dropoff_lat.toFixed(5)}, {selectedRequest.dropoff_lng.toFixed(5)}</p>
                  </div>
                </div>

                {/* Fare & Duration */}
                <div className="flex gap-4">
                  {selectedRequest.estimated_fare != null && (
                    <div><p className="text-xs text-muted-foreground">Est. Fare</p><p className="font-bold">${Number(selectedRequest.estimated_fare).toFixed(2)}</p></div>
                  )}
                  {selectedRequest.estimated_minutes != null && (
                    <div><p className="text-xs text-muted-foreground">Est. Duration</p><p className="font-bold">{selectedRequest.estimated_minutes} min</p></div>
                  )}
                </div>

                {/* Driver */}
                {selectedRequest.driver_id && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Driver</p>
                    <p className="font-medium">{selectedRequest.driver_name || "Assigned"}</p>
                    <p className="text-xs font-mono text-muted-foreground">{selectedRequest.driver_id}</p>
                  </div>
                )}

                {/* Timeline */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Timeline</p>
                  <div className="text-sm space-y-1">
                    <p>📍 Created: {format(new Date(selectedRequest.created_at), "yyyy-MM-dd HH:mm:ss")}</p>
                    <p>🔄 Last Updated: {format(new Date(selectedRequest.updated_at), "yyyy-MM-dd HH:mm:ss")}</p>
                  </div>
                </div>

                {/* Linked ride */}
                {selectedRequest.ride_id && (
                  <div className="text-xs text-muted-foreground">
                    Linked ride: <span className="font-mono">{selectedRequest.ride_id.slice(0, 8)}...</span>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default AdminRideRequests;
