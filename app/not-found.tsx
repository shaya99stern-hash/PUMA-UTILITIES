import { Compass } from 'lucide-react';
import { Button, EmptyState } from '@/app/ui';

export default function NotFound() {
  return (
    <div className="page page--narrow" style={{ paddingTop: 64 }}>
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="This page may have moved. Head back home or open your companies."
        actions={
          <>
            <Button href="/">Home</Button>
            <Button variant="primary" href="/companies">
              Companies
            </Button>
          </>
        }
      />
    </div>
  );
}
