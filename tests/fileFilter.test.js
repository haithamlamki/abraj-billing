import { describe, it, expect } from 'vitest';
import { shouldSkipFile, detectRigFromFilename } from '../src/pipeline/fileFilter.js';

// ─── shouldSkipFile ───────────────────────────────────────────────────────────

describe('shouldSkipFile — skip cases', () => {
  it('skips rig-move reports (word "move" with word boundary)', () => {
    expect(shouldSkipFile('BST 384 Move Feb Rig110.pdf').skip).toBe(true);
    expect(shouldSkipFile('Rig204 Move Feb2026.xlsx').skip).toBe(true);
    // underscore is \w so _Move_ has no word boundary — NOT skipped
    expect(shouldSkipFile('Rig204_Move_Feb2026.xlsx').skip).toBe(false);
  });

  it('reason is "rig-move report" for move files', () => {
    expect(shouldSkipFile('Rig104 Move.pdf').reason).toBe('rig-move report');
  });

  it('skips DocuSign files (case-insensitive)', () => {
    expect(shouldSkipFile('Docusign_Rig204_Feb.pdf').skip).toBe(true);
    expect(shouldSkipFile('DOCUSIGN_signed.pdf').skip).toBe(true);
  });

  it('reason is "docusign file" for docusign files', () => {
    expect(shouldSkipFile('docusign_rig104.pdf').reason).toBe('docusign file');
  });

  it('skips ticket-only files (no "billing" in name)', () => {
    expect(shouldSkipFile('Rig204 Feb ticket.pdf').skip).toBe(true);
    // underscore is \w so _TICKET_ has no word boundary — NOT skipped
    expect(shouldSkipFile('Rig104_TICKET_Feb.xlsx').skip).toBe(false);
  });

  it('reason is "ticket-only file" for ticket-only files', () => {
    expect(shouldSkipFile('rig204 ticket.pdf').reason).toBe('ticket-only file');
  });

  it('"move" match requires word boundary — does not match "removed"', () => {
    expect(shouldSkipFile('Rig204_removed_entries.xlsx').skip).toBe(false);
  });
});

describe('shouldSkipFile — keep cases', () => {
  it('keeps normal billing Excel files', () => {
    expect(shouldSkipFile('Rig204_Feb_2026.xlsx').skip).toBe(false);
    expect(shouldSkipFile('204_March_2026.xlsx').skip).toBe(false);
  });

  it('keeps normal billing PDFs', () => {
    expect(shouldSkipFile('Rig305 Feb Billing.pdf').skip).toBe(false);
  });

  it('keeps combined "Billing & Ticket" files (ticket + billing keyword)', () => {
    expect(shouldSkipFile('Rig204 Billing & Ticket Feb.pdf').skip).toBe(false);
    expect(shouldSkipFile('RIG104 Feb billing ticket.xlsx').skip).toBe(false);
  });

  it('returns empty reason string when not skipped', () => {
    expect(shouldSkipFile('Rig204_Feb_2026.xlsx').reason).toBe('');
  });
});

// ─── detectRigFromFilename ────────────────────────────────────────────────────

describe('detectRigFromFilename', () => {
  it('detects rig from leading 3 digits', () => {
    expect(detectRigFromFilename('204_March_2026.xlsx')).toBe(204);
    expect(detectRigFromFilename('305_Feb_Billing.pdf')).toBe(305);
  });

  it('detects rig from "Rig NNN" pattern (case-insensitive)', () => {
    expect(detectRigFromFilename('Rig104 Feb.pdf')).toBe(104);
    expect(detectRigFromFilename('RIG 305 billing.xlsx')).toBe(305);
    expect(detectRigFromFilename('rig_204_march.pdf')).toBe(204);
    expect(detectRigFromFilename('RIG-110 Feb 2026.pdf')).toBe(110);
  });

  it('detects rig when embedded after other text', () => {
    expect(detectRigFromFilename('BST 384 Move Feb Rig110.pdf')).toBe(110);
  });

  it('prefers leading digits over rig keyword', () => {
    // "204_..." matches leading-digit pattern before "Rig110" pattern is tried
    expect(detectRigFromFilename('204_Rig110_Feb.xlsx')).toBe(204);
  });

  it('returns null when no rig number found', () => {
    expect(detectRigFromFilename('no-rig-here.xlsx')).toBeNull();
    expect(detectRigFromFilename('summary_report.pdf')).toBeNull();
  });

  it('returns null for a 2-digit number at start', () => {
    // Regex requires exactly 3 leading digits
    expect(detectRigFromFilename('20_Feb_billing.xlsx')).toBeNull();
  });
});
