import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { 
  CreditCard, 
  Plus, 
  Trash2, 
  Star, 
  Loader2,
  Check
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface SavedCard {
  id: string;
  nickname: string;
  card_brand: string;
  card_last_four: string;
  card_exp_month: number;
  card_exp_year: number;
  is_default: boolean;
}

interface SavedCardsSelectorProps {
  onSelectCard: (cardId: string) => void;
  onPayWithNew: () => void;
  selectedCardId: string | null;
}

const brandIcons: Record<string, string> = {
  visa: '💳',
  mastercard: '💳',
  amex: '💳',
  discover: '💳',
  unknown: '💳',
};

export const SavedCardsSelector = ({ 
  onSelectCard, 
  onPayWithNew,
  selectedCardId 
}: SavedCardsSelectorProps) => {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchCards = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('manage-saved-cards', {
        body: { action: 'list' },
      });

      if (error) throw error;
      setCards(data.cards || []);
      
      // Auto-select default card if none selected
      if (!selectedCardId && data.cards?.length > 0) {
        const defaultCard = data.cards.find((c: SavedCard) => c.is_default);
        if (defaultCard) {
          onSelectCard(defaultCard.id);
        }
      }
    } catch (err: any) {
      console.error('Error fetching saved cards:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCards();
  }, []);

  const handleDelete = async (cardId: string) => {
    setDeletingId(cardId);
    try {
      const { error } = await supabase.functions.invoke('manage-saved-cards', {
        body: { action: 'delete', cardId },
      });

      if (error) throw error;

      toast({
        title: 'Card removed',
        description: 'The card has been removed from your account.',
      });

      // If we deleted the selected card, clear selection
      if (selectedCardId === cardId) {
        onSelectCard('');
      }

      fetchCards();
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to remove card',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (cardId: string) => {
    try {
      const { error } = await supabase.functions.invoke('manage-saved-cards', {
        body: { action: 'set_default', cardId },
      });

      if (error) throw error;
      fetchCards();
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to set default card',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {cards.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">Your saved cards</Label>
          {cards.map((card) => (
            <Card
              key={card.id}
              className={`p-4 cursor-pointer transition-all ${
                selectedCardId === card.id
                  ? 'ring-2 ring-primary bg-primary/5'
                  : 'hover:bg-muted/50'
              }`}
              onClick={() => onSelectCard(card.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted">
                    <CreditCard className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{card.nickname}</span>
                      {card.is_default && (
                        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {card.card_brand.charAt(0).toUpperCase() + card.card_brand.slice(1)} •••• {card.card_last_four}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expires {card.card_exp_month.toString().padStart(2, '0')}/{card.card_exp_year.toString().slice(-2)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedCardId === card.id && (
                    <Check className="h-5 w-5 text-primary" />
                  )}
                  {!card.is_default && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetDefault(card.id);
                      }}
                      title="Set as default"
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(card.id);
                    }}
                    disabled={deletingId === card.id}
                    className="text-destructive hover:text-destructive"
                  >
                    {deletingId === card.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={onPayWithNew}
      >
        <Plus className="h-4 w-4 mr-2" />
        {cards.length > 0 ? 'Use a different card' : 'Add a card'}
      </Button>
    </div>
  );
};

interface SaveCardFormProps {
  paymentMethodId: string;
  onSaved: () => void;
  onSkip: () => void;
}

export const SaveCardPrompt = ({ paymentMethodId, onSaved, onSkip }: SaveCardFormProps) => {
  const [nickname, setNickname] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!nickname.trim()) {
      toast({
        title: 'Enter a nickname',
        description: 'Please enter a nickname for this card (e.g., "Personal Visa")',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.functions.invoke('manage-saved-cards', {
        body: { 
          action: 'save', 
          paymentMethodId,
          nickname: nickname.trim(),
        },
      });

      if (error) throw error;

      toast({
        title: 'Card saved!',
        description: 'Your card has been saved for future payments.',
      });
      onSaved();
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to save card',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="text-center">
        <CreditCard className="h-12 w-12 mx-auto text-primary mb-2" />
        <h3 className="text-lg font-semibold">Save this card?</h3>
        <p className="text-sm text-muted-foreground">
          Save it for faster checkout next time
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nickname">Card nickname</Label>
        <Input
          id="nickname"
          placeholder="e.g., Personal Visa, Work Card"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={30}
        />
      </div>

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onSkip}
          disabled={isSaving}
        >
          Skip
        </Button>
        <Button
          className="flex-1"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            'Save Card'
          )}
        </Button>
      </div>
    </Card>
  );
};

export default SavedCardsSelector;
