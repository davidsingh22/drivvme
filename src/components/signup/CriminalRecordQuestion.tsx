import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

interface CriminalRecordQuestionProps {
  value: boolean | null;
  onChange: (hasRecord: boolean) => void;
}

const CriminalRecordQuestion = ({ value, onChange }: CriminalRecordQuestionProps) => {
  return (
    <div className="space-y-3">
      <Label className="text-base font-medium">Do you have a criminal record? *</Label>
      <div className="space-y-2">
        <div className="flex items-center space-x-3">
          <Checkbox
            id="no-criminal"
            checked={value === false}
            onCheckedChange={() => onChange(false)}
          />
          <label htmlFor="no-criminal" className="text-sm cursor-pointer">
            No
          </label>
        </div>
        <div className="flex items-center space-x-3">
          <Checkbox
            id="yes-criminal"
            checked={value === true}
            onCheckedChange={() => onChange(true)}
          />
          <label htmlFor="yes-criminal" className="text-sm cursor-pointer">
            Yes
          </label>
        </div>
      </div>
    </div>
  );
};

export default CriminalRecordQuestion;
