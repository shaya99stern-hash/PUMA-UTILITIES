import { pumaIcon } from '../components/puma-icon-response';

export const runtime = 'edge';

export function GET(request: Request) {
  return pumaIcon(request, 180);
}
