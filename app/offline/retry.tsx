'use client';

import { RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/app/ui';

export function OfflineRetry() {
  useEffect(() => {
    const back = () => window.location.reload();
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, []);
  return (
    <Button variant="primary" block icon={RotateCw} onClick={() => window.location.reload()}>
      Try again
    </Button>
  );
}
