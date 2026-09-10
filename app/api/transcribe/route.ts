import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const endpoint = process.env.PUMA_TRANSCRIPTION_ENDPOINT;
  const token = process.env.PUMA_TRANSCRIPTION_TOKEN;

  if (!endpoint || !token) {
    return NextResponse.json({ error: 'transcription_not_configured' }, { status: 501 });
  }

  const incoming = await request.formData();
  const audio = incoming.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: 'audio_required' }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append('audio', audio, audio.name || 'puma-voice.webm');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: upstream,
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'transcription_failed' }, { status: 502 });
    }

    const payload = await response.json() as { transcript?: unknown; text?: unknown };
    const transcript = typeof payload.transcript === 'string'
      ? payload.transcript.trim()
      : typeof payload.text === 'string'
        ? payload.text.trim()
        : '';

    if (!transcript) {
      return NextResponse.json({ error: 'transcript_missing' }, { status: 502 });
    }

    return NextResponse.json({ transcript });
  } catch {
    return NextResponse.json({ error: 'transcription_failed' }, { status: 502 });
  }
}
