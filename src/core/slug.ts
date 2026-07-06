export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function slugifyIssueTitle(title: string): string {
  const slug = slugify(title).slice(0, 48);

  return slug || 'issue';
}
