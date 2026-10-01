/** Renders one campaign step for one recipient into a sendable message. Pure. */
import { footerHtml, footerText, listUnsubscribeHeaders, unsubscribeUrl, wrapEmailHtml } from './compliance';
import { buildMergeVars, htmlToText, renderMerge, sanitizeEmailHtml, unknownTags, usedTags, type MergeSource, type MergeVars } from './merge';
import type { CampaignSettings } from './settings';
import { rewriteLinks, trackingPixel } from './tracking';

export type RenderInput = {
  step: { subject: string; body_html: string };
  stepIndex: number;
  /** Subject of step 1 after merge; follow-ups with an empty subject become "Re: <this>". */
  firstSubject?: string | null;
  recipient: MergeSource;
  token: string;
  sender: { name?: string | null; email: string };
  signatureHtml?: string | null;
  settings: Pick<CampaignSettings, 'trackOpens' | 'trackClicks' | 'includeSignature'>;
  workspace: { address: string; companyName?: string | null };
  baseUrl: string;
  /** Previews and tests never use real tracking links. */
  preview?: boolean;
  /** Add a mailto: to List-Unsubscribe (the sending mailbox). */
  mailtoUnsubscribe?: boolean;
};

export type Rendered = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  unsubscribeUrl: string;
  /** Merge tags that had no value and no fallback for this recipient. */
  missing: string[];
  unknown: string[];
};

export function stripReplyPrefix(subject: string): string {
  return subject.replace(/^\s*((re|fwd?)\s*:\s*)+/i, '').trim();
}

export function renderEmail(input: RenderInput): Rendered {
  const vars: MergeVars = buildMergeVars(input.recipient, input.sender);
  const template = `${input.step.subject}\n${input.step.body_html}`;

  const missing = usedTags(template).filter((tag) => {
    if (vars[tag]?.toString().trim()) return false;
    // Has a fallback somewhere in the template?
    const withFallback = new RegExp(`\\{\\{\\s*${tag}\\s*\\|\\s*[^}\\s][^}]*\\}\\}`, 'i');
    const all = new RegExp(`\\{\\{\\s*${tag}\\s*(\\|[^}]*)?\\}\\}`, 'gi');
    const occurrences = template.match(all) ?? [];
    return occurrences.some((o) => !withFallback.test(o));
  });

  let subject = renderMerge(input.step.subject, vars).replace(/\s+/g, ' ').trim();
  if (!subject && input.stepIndex > 0 && input.firstSubject) subject = `Re: ${stripReplyPrefix(input.firstSubject)}`;

  const body = renderMerge(sanitizeEmailHtml(input.step.body_html), vars, { html: true });
  const signature = input.settings.includeSignature && input.signatureHtml ? `<div style="margin-top:16px">${sanitizeEmailHtml(input.signatureHtml)}</div>` : '';
  const unsub = unsubscribeUrl(input.baseUrl, input.preview ? 'preview' : input.token);
  const footerArgs = { address: input.workspace.address, unsubscribeUrl: unsub, senderName: input.sender.name, companyName: input.workspace.companyName };

  let content = body + signature;
  if (!input.preview && input.settings.trackClicks) {
    content = rewriteLinks(content, { baseUrl: input.baseUrl, token: input.token, step: input.stepIndex });
  }
  let html = wrapEmailHtml(content + footerHtml(footerArgs));
  if (!input.preview && input.settings.trackOpens) html += trackingPixel(input.baseUrl, input.token, input.stepIndex);

  const text = `${htmlToText(body + signature)}\n${footerText(footerArgs)}`.trim();
  const headers = listUnsubscribeHeaders({ url: unsub, mailto: input.mailtoUnsubscribe === false ? null : input.sender.email });

  return { subject, html, text, headers, unsubscribeUrl: unsub, missing, unknown: unknownTags(template) };
}
