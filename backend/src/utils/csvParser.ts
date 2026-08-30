const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParseResult {
  valid: string[];
  invalid: string[];
  totalCount: number;
}

/**
 * Parses email addresses from a raw CSV or plain text string.
 * Automatically identifies the email column based on headers.
 */
export function parseEmails(content: string): ParseResult {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const validSet = new Set<string>();
  const invalidSet = new Set<string>();

  if (lines.length === 0) {
    return { valid: [], invalid: [], totalCount: 0 };
  }

  // 1. Inspect first line for header column names
  const firstLineParts = lines[0].split(',').map(p => p.trim().toLowerCase());
  let emailColIdx = 0; // Default to first column

  const headerKeywords = ['email', 'emails', 'recipient', 'recipients', 'to', 'address'];
  for (let i = 0; i < firstLineParts.length; i++) {
    if (headerKeywords.includes(firstLineParts[i])) {
      emailColIdx = i;
      break;
    }
  }

  // Determine if the first line is actually a header row
  const isHeaderRow = firstLineParts.some(part => headerKeywords.includes(part));
  const startRowIdx = isHeaderRow ? 1 : 0;

  for (let i = startRowIdx; i < lines.length; i++) {
    const parts = lines[i].split(',');
    // Extract the specific cell corresponding to the email column
    const emailCell = (parts[emailColIdx] || '').trim();
    if (!emailCell) continue;

    // Remove surrounding quotes if any
    const cleanedEmail = emailCell.replace(/['"“”]/g, '').trim();
    if (!cleanedEmail) continue;

    if (EMAIL_REGEX.test(cleanedEmail)) {
      validSet.add(cleanedEmail.toLowerCase()); // Normalize casing
    } else {
      invalidSet.add(cleanedEmail);
    }
  }

  return {
    valid: Array.from(validSet),
    invalid: Array.from(invalidSet),
    totalCount: validSet.size + invalidSet.size,
  };
}
