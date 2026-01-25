import { useState, useRef } from 'react';
import { Camera, User, Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

interface ProfilePictureUploadProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  required?: boolean;
}

const ProfilePictureUpload = ({ onFileSelect, selectedFile, required = false }: ProfilePictureUploadProps) => {
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isValidFileType(file)) {
      onFileSelect(file);
      const reader = new FileReader();
      reader.onload = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const isValidFileType = (file: File) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    return validTypes.includes(file.type);
  };

  return (
    <div className="space-y-2">
      <Label>Profile Picture {required && '*'}</Label>
      <div className="flex items-center gap-4">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="relative cursor-pointer group"
        >
          <Avatar className="h-20 w-20 border-2 border-dashed border-border group-hover:border-primary transition-colors">
            {preview ? (
              <AvatarImage src={preview} alt="Profile preview" />
            ) : (
              <AvatarFallback className="bg-muted">
                <User className="h-8 w-8 text-muted-foreground" />
              </AvatarFallback>
            )}
          </Avatar>
          <div className="absolute bottom-0 right-0 bg-primary text-primary-foreground rounded-full p-1.5 shadow-md">
            <Camera className="h-4 w-4" />
          </div>
        </div>
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">
            {selectedFile ? selectedFile.name : 'Click to upload your profile picture'}
          </p>
          <p className="text-xs text-muted-foreground">
            JPG, PNG or WEBP
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
};

export default ProfilePictureUpload;
