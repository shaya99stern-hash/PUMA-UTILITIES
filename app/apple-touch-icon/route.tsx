import { pumaIcon } from '../components/puma-icon-response';

export const runtime = 'edge';

export function GET() {
  return pumaIcon(180);
}
