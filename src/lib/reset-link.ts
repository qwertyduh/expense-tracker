let pendingResetUrl: string | null = null;

export function setPendingResetUrl(url: string): void {
  pendingResetUrl = url;
}

export function takePendingResetUrl(): string | null {
  const url = pendingResetUrl;
  pendingResetUrl = null;
  return url;
}
