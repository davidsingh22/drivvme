import { useState, useEffect } from 'react';

type TimeOfDay = 'day' | 'night';

export const useTimeOfDay = () => {
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(() => {
    const hour = new Date().getHours();
    return hour >= 6 && hour < 19 ? 'day' : 'night';
  });

  useEffect(() => {
    const checkTime = () => {
      const hour = new Date().getHours();
      const newTimeOfDay = hour >= 6 && hour < 19 ? 'day' : 'night';
      setTimeOfDay(newTimeOfDay);
    };

    // Check every minute for time changes
    const interval = setInterval(checkTime, 60000);

    return () => clearInterval(interval);
  }, []);

  return timeOfDay;
};
