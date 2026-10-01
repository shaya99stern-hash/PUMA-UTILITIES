import { notFound } from 'next/navigation';
import { Preview } from './preview';

/** Living style guide for the UI kit (development only): /ui/preview */
export default function UiPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Preview />;
}
