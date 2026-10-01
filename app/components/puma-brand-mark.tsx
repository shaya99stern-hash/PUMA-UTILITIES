import { BrandMark } from '@/app/ui/brand-mark';

/** Legacy export — use `BrandMark` from app/ui/brand-mark. */
export default function PumaBrandMark({ size = 28 }: { size?: number }) {
  return <BrandMark size={size} />;
}
