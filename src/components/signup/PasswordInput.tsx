import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  id: string;
  showValidation?: boolean;
}

const PasswordInput = ({ value, onChange, label, id, showValidation = false }: PasswordInputProps) => {
  const [showPassword, setShowPassword] = useState(false);
  
  const hasMinLength = value.length >= 7;
  const hasNumber = /\d/.test(value);
  const isValid = hasMinLength && hasNumber;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          className="bg-background pr-10"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      {showValidation && value.length > 0 && (
        <div className="text-xs space-y-1">
          <div className={`flex items-center gap-1 ${hasMinLength ? 'text-green-500' : 'text-destructive'}`}>
            {hasMinLength ? '✓' : '✗'} At least 7 characters
          </div>
          <div className={`flex items-center gap-1 ${hasNumber ? 'text-green-500' : 'text-destructive'}`}>
            {hasNumber ? '✓' : '✗'} At least 1 number
          </div>
        </div>
      )}
    </div>
  );
};

export default PasswordInput;
