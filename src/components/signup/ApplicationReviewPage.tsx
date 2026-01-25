import { motion } from 'framer-motion';
import { Clock, Mail, Phone, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

const ApplicationReviewPage = () => {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center space-y-6"
    >
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Clock className="h-10 w-10 text-primary" />
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold">Application Review & Notification</h1>
        <p className="text-muted-foreground">
          Thank you for submitting your application to drive with Drivveme.
        </p>
      </div>

      <div className="bg-muted/50 rounded-lg p-6 text-left space-y-4">
        <p className="text-sm">
          Your application is currently under review. Our team will carefully review your information 
          to ensure it meets our platform requirements. Once the review is complete, Drivveme will 
          notify you of your approval status within <strong>24 hours</strong>.
        </p>

        <div className="flex items-start gap-3 p-3 bg-background rounded-lg">
          <Mail className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <p className="text-sm font-medium">Email Notification</p>
            <p className="text-xs text-muted-foreground">
              You will be contacted by email using the address you provided during registration.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 bg-background rounded-lg">
          <Phone className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <p className="text-sm font-medium">Phone Contact</p>
            <p className="text-xs text-muted-foreground">
              We may also reach out by phone if additional information or documentation is required.
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Please make sure your email address and phone number are accurate and available during this time.
        </p>
      </div>

      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <CheckCircle className="h-4 w-4 text-green-500" />
        <span>We appreciate your interest in joining Drivveme!</span>
      </div>

      <Button
        onClick={() => navigate('/')}
        variant="outline"
        className="w-full"
      >
        Return to Home
      </Button>
    </motion.div>
  );
};

export default ApplicationReviewPage;
