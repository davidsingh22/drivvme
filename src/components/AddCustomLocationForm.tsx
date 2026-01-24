import { useState } from 'react';
import { MapPin, Search, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useMapboxToken } from '@/hooks/useMapboxToken';
import { useToast } from '@/hooks/use-toast';

interface AddCustomLocationFormProps {
  onLocationAdded?: () => void;
}

export default function AddCustomLocationForm({ onLocationAdded }: AddCustomLocationFormProps) {
  const { token } = useMapboxToken();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [searchAddress, setSearchAddress] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [category, setCategory] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{
    id: string;
    name: string;
    address: string;
    center: [number, number];
  }>>([]);

  const searchMapbox = async (query: string) => {
    if (!token || query.length < 2) {
      setSuggestions([]);
      return;
    }

    setIsSearching(true);
    try {
      const params = new URLSearchParams({
        access_token: token,
        country: 'ca',
        types: 'poi,address,place',
        limit: '5',
        fuzzyMatch: 'true',
        autocomplete: 'true',
        proximity: '-73.5673,45.5017',
        language: 'en,fr',
      });
      
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`
      );
      const data = await response.json();

      if (data.features) {
        setSuggestions(
          data.features.map((f: any) => {
            const parts = f.place_name.split(', ');
            return {
              id: f.id,
              name: parts[0],
              address: parts.slice(1).join(', '),
              center: f.center,
            };
          })
        );
      }
    } catch (err) {
      console.error('Mapbox search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectAddress = (suggestion: typeof suggestions[0]) => {
    setSelectedAddress(`${suggestion.name}, ${suggestion.address}`);
    setCoordinates({ lat: suggestion.center[1], lng: suggestion.center[0] });
    setSuggestions([]);
    setSearchAddress('');
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    if (!selectedAddress || !coordinates) {
      toast({ title: 'Please select an address from the search', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.from('custom_locations').insert({
        name: name.trim(),
        address: selectedAddress,
        lat: coordinates.lat,
        lng: coordinates.lng,
        category: category.trim() || null,
      });

      if (error) throw error;

      toast({ title: 'Location added successfully!' });
      setOpen(false);
      resetForm();
      onLocationAdded?.();
    } catch (error: any) {
      console.error('Error saving location:', error);
      toast({ 
        title: 'Failed to save location', 
        description: error.message,
        variant: 'destructive' 
      });
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setName('');
    setSearchAddress('');
    setSelectedAddress('');
    setCoordinates(null);
    setCategory('');
    setSuggestions([]);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Custom Location
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Custom Location</DialogTitle>
          <DialogDescription>
            Add a location that riders can search for. Search for the address to get coordinates.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Location Name *</Label>
            <Input
              id="name"
              placeholder="e.g., PALMA Restaurant"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category (optional)</Label>
            <Input
              id="category"
              placeholder="e.g., Restaurant, Hotel, Club"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Address *</Label>
            {selectedAddress ? (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <MapPin className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm flex-1">{selectedAddress}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => { setSelectedAddress(''); setCoordinates(null); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Search className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <Input
                  placeholder="Search for address..."
                  value={searchAddress}
                  onChange={(e) => {
                    setSearchAddress(e.target.value);
                    searchMapbox(e.target.value);
                  }}
                  className="pl-10"
                />
                
                {suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="w-full px-3 py-2 text-left hover:bg-muted text-sm flex items-start gap-2"
                        onClick={() => handleSelectAddress(s)}
                      >
                        <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <div className="font-medium">{s.name}</div>
                          <div className="text-muted-foreground text-xs">{s.address}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {coordinates && (
            <p className="text-xs text-muted-foreground">
              Coordinates: {coordinates.lat.toFixed(6)}, {coordinates.lng.toFixed(6)}
            </p>
          )}

          <Button 
            onClick={handleSave} 
            disabled={isSaving || !name.trim() || !selectedAddress}
            className="w-full"
          >
            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Add Location
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
