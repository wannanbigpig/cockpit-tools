export interface GeminiAccount {
  id: string;
  email: string;
  auth_id?: string | null;
  name?: string | null;
  tags?: string[] | null;

  access_token: string;
  refresh_token?: string | null;
  id_token?: string | null;
  token_type?: string | null;
  scope?: string | null;
  expiry_date?: number | null;

  selected_auth_type?: string | null;
  project_id?: string | null;
  tier_id?: string | null;
  plan_name?: string | null;
  membership_type?: string | null;
  subscription_status?: string | null;
  sign_up_type?: string | null;

  gemini_auth_raw?: unknown;
  gemini_usage_raw?: unknown;

  status?: string | null;
  status_reason?: string | null;

  created_at: number;
  last_used: number;

  plan_type?: string;
  quota?: GeminiQuota;
}

export interface GeminiQuota {
  hourly_percentage: number;
  hourly_reset_time?: number | null;
  weekly_percentage: number;
  weekly_reset_time?: number | null;
  raw_data?: unknown;
}

export interface GeminiUsageBucket {
  modelId: string;
  label: string;
  remainingPercent: number;
  resetAt: number | null;
}

export interface GeminiQuotaDisplayItem {
  key: string;
  label: string;
  remainingPercent: number;
  resetAt: number | null;
}

export interface GeminiUsage {
  inlineSuggestionsUsedPercent?: number | null;
  chatMessagesUsedPercent?: number | null;
  allowanceResetAt?: number | null;
  planUsedCents?: number | null;
  planLimitCents?: number | null;
  totalPercentUsed: number | null;
  autoPercentUsed?: number | null;
  apiPercentUsed?: number | null;
  onDemandUsedCents?: number | null;
  onDemandLimitCents?: number | null;
  teamOnDemandUsedCents?: number | null;
  teamOnDemandLimitCents?: number | null;
  onDemandEnabled?: boolean | null;
  onDemandLimitType?: string | null;
  buckets: GeminiUsageBucket[];
}

export interface GeminiTierQuotaSummary {
  key: 'pro' | 'flash';
  label: 'Pro' | 'Flash';
  remainingPercent: number | null;
  resetAt: number | null;
}

type JsonMap = Record<string, unknown>;

function toObject(value: unknown): JsonMap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonMap;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseResetAt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null;
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number.parseFloat(trimmed);
  if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(trimmed)) {
    return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function formatGeminiModelLabel(value: string): string {
  const raw = value.trim();
  if (!raw) return 'Gemini';

  const stripped = raw.replace(/^gemini-/i, '');
  const parts = stripped.split('-').filter(Boolean);
  if (parts.length === 0) return raw;

  const tokens = parts.map((part) => {
    if (/^\d+(\.\d+)?$/.test(part)) return part;
    if (/^\d{2,4}$/.test(part)) return part;

    switch (part.toLowerCase()) {
      case 'flash':
        return 'Flash';
      case 'lite':
        return 'Lite';
      case 'pro':
        return 'Pro';
      case 'preview':
        return 'Preview';
      case 'exp':
        return 'Exp';
      default:
        return part.charAt(0).toUpperCase() + part.slice(1);
    }
  });

  return `Gemini ${tokens.join(' ')}`;
}

function parseGeminiQuotaDisplayItemsFromRaw(rawValue: unknown): GeminiQuotaDisplayItem[] {
  const raw = toObject(rawValue);
  if (!raw) return [];

  const bucketsRaw = raw.buckets;
  const bucketItems = Array.isArray(bucketsRaw)
    ? bucketsRaw
        .map((item) => {
          const bucket = toObject(item);
          if (!bucket) return null;

          const modelId =
            typeof bucket.modelId === 'string' ? bucket.modelId.trim() : '';
          const remainingValue =
            toNumber(bucket.remainingFraction) ??
            toNumber(bucket.remaining_percentage) ??
            toNumber(bucket.remainingPercent) ??
            toNumber(bucket.remaining_fraction);

          if (!modelId || remainingValue == null) return null;

          const remainingPercent =
            remainingValue <= 1
              ? clampPercent(remainingValue * 100)
              : clampPercent(remainingValue);

          return {
            key: modelId,
            label: formatGeminiModelLabel(modelId),
            remainingPercent,
            resetAt: parseResetAt(bucket.resetTime ?? bucket.reset_time),
          } satisfies GeminiQuotaDisplayItem;
        })
        .filter((item): item is GeminiQuotaDisplayItem => item !== null)
    : [];

  if (bucketItems.length > 0) {
    const merged = new Map<string, GeminiQuotaDisplayItem>();
    for (const item of bucketItems) {
      const prev = merged.get(item.key);
      if (!prev) {
        merged.set(item.key, item);
        continue;
      }

      if (item.remainingPercent < prev.remainingPercent) {
        merged.set(item.key, item);
        continue;
      }

      if (
        item.remainingPercent === prev.remainingPercent &&
        item.resetAt != null &&
        (prev.resetAt == null || item.resetAt < prev.resetAt)
      ) {
        merged.set(item.key, item);
      }
    }

    return Array.from(merged.values()).sort((a, b) => a.key.localeCompare(b.key));
  }

  const modelsRaw = raw.models;
  const modelEntries = Array.isArray(modelsRaw)
    ? modelsRaw
    : modelsRaw && typeof modelsRaw === 'object'
      ? Object.entries(modelsRaw).map(([name, info]) => ({
          name,
          ...(toObject(info) ?? {}),
        }))
      : [];

  return modelEntries
    .map((item, index) => {
      const model = toObject(item);
      if (!model) return null;

      const rawName = String(
        model.name ?? model.model ?? model.id ?? `model-${index}`,
      ).trim();
      if (!rawName) return null;

      const remainingValue =
        toNumber(model.percentage) ??
        toNumber(model.remaining_percentage) ??
        toNumber(model.remainingFraction) ??
        toNumber(model.remaining_fraction);
      if (remainingValue == null) return null;

      return {
        key: rawName,
        label:
          typeof model.display_name === 'string' && model.display_name.trim()
            ? model.display_name.trim()
            : typeof model.displayName === 'string' && model.displayName.trim()
              ? model.displayName.trim()
              : formatGeminiModelLabel(rawName),
        remainingPercent:
          remainingValue <= 1
            ? clampPercent(remainingValue * 100)
            : clampPercent(remainingValue),
        resetAt: parseResetAt(model.reset_time ?? model.resetTime),
      } satisfies GeminiQuotaDisplayItem;
    })
    .filter((item): item is GeminiQuotaDisplayItem => item !== null)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function getGeminiAccountDisplayEmail(account: GeminiAccount): string {
  const email = account.email?.trim();
  if (email) return email;
  const name = account.name?.trim();
  if (name) return name;
  return account.id;
}

function resolveGeminiPlanBucket(rawTier: string): 'free' | 'pro' | 'ultra' | 'unknown' {
  const lower = rawTier.trim().toLowerCase();
  if (!lower) return 'unknown';
  if (lower.includes('ultra')) return 'ultra';
  if (lower === 'standard-tier') return 'free';
  if (lower.includes('pro') || lower.includes('premium')) return 'pro';
  if (lower === 'free-tier' || lower.includes('free')) return 'free';
  return 'unknown';
}

export function getGeminiPlanBadge(account: GeminiAccount): string {
  const raw = (account.plan_name || account.tier_id || '').trim();
  const bucket = resolveGeminiPlanBucket(raw);
  if (bucket === 'free') return 'FREE';
  if (bucket === 'pro') return 'PRO';
  if (bucket === 'ultra') return 'ULTRA';
  return 'UNKNOWN';
}

export function getGeminiPlanDisplayName(account: GeminiAccount): string {
  return getGeminiPlanBadge(account);
}

export function getGeminiPlanBadgeClass(
  planType?: string | null,
  account?: GeminiAccount,
): string {
  const raw = (planType || account?.plan_name || account?.tier_id || '').trim();
  const bucket = resolveGeminiPlanBucket(raw);
  if (bucket === 'ultra') return 'ultra';
  if (bucket === 'pro') return 'pro';
  if (bucket === 'free') return 'free';
  return 'unknown';
}

export function getGeminiQuotaDisplayItems(
  account: GeminiAccount,
  limit?: number,
): GeminiQuotaDisplayItem[] {
  const fromUsageRaw = parseGeminiQuotaDisplayItemsFromRaw(account.gemini_usage_raw);
  if (fromUsageRaw.length > 0) {
    return typeof limit === 'number' ? fromUsageRaw.slice(0, limit) : fromUsageRaw;
  }

  const fromQuotaRaw = parseGeminiQuotaDisplayItemsFromRaw(account.quota?.raw_data);
  if (fromQuotaRaw.length > 0) {
    return typeof limit === 'number' ? fromQuotaRaw.slice(0, limit) : fromQuotaRaw;
  }

  const legacyItems: GeminiQuotaDisplayItem[] = [];
  if (typeof account.quota?.hourly_percentage === 'number') {
    legacyItems.push({
      key: 'hourly',
      label: '5小时',
      remainingPercent: clampPercent(account.quota.hourly_percentage),
      resetAt: parseResetAt(account.quota.hourly_reset_time),
    });
  }
  if (typeof account.quota?.weekly_percentage === 'number') {
    legacyItems.push({
      key: 'weekly',
      label: '每周',
      remainingPercent: clampPercent(account.quota.weekly_percentage),
      resetAt: parseResetAt(account.quota.weekly_reset_time),
    });
  }

  return typeof limit === 'number' ? legacyItems.slice(0, limit) : legacyItems;
}

export function getGeminiUsage(account: GeminiAccount): GeminiUsage {
  const parsedBuckets: GeminiUsageBucket[] = getGeminiQuotaDisplayItems(account).map((item) => ({
    modelId: item.key,
    label: item.label,
    remainingPercent: item.remainingPercent,
    resetAt: item.resetAt,
  }));

  const lowestRemaining = parsedBuckets.length
    ? parsedBuckets.reduce((min, item) => Math.min(min, item.remainingPercent), 100)
    : null;

  return {
    inlineSuggestionsUsedPercent: lowestRemaining == null ? null : clampPercent(100 - lowestRemaining),
    chatMessagesUsedPercent: lowestRemaining == null ? null : clampPercent(100 - lowestRemaining),
    allowanceResetAt: null,
    planUsedCents: null,
    planLimitCents: null,
    totalPercentUsed: lowestRemaining == null ? null : clampPercent(100 - lowestRemaining),
    autoPercentUsed: null,
    apiPercentUsed: null,
    onDemandUsedCents: null,
    onDemandLimitCents: null,
    teamOnDemandUsedCents: null,
    teamOnDemandLimitCents: null,
    onDemandEnabled: null,
    onDemandLimitType: null,
    buckets: parsedBuckets,
  };
}

function pickLowestRemainingBucket(
  buckets: GeminiUsageBucket[],
  matcher: (modelId: string) => boolean,
): GeminiUsageBucket | null {
  const matched = buckets.filter((bucket) => matcher(bucket.modelId.toLowerCase()));
  if (matched.length === 0) return null;

  return matched.reduce((prev, curr) => {
    if (curr.remainingPercent < prev.remainingPercent) {
      return curr;
    }
    if (curr.remainingPercent > prev.remainingPercent) {
      return prev;
    }

    if (prev.resetAt == null) return curr;
    if (curr.resetAt == null) return prev;
    return curr.resetAt < prev.resetAt ? curr : prev;
  });
}

export function getGeminiTierQuotaSummary(account: GeminiAccount): {
  pro: GeminiTierQuotaSummary;
  flash: GeminiTierQuotaSummary;
} {
  const usage = getGeminiUsage(account);
  const proBucket = pickLowestRemainingBucket(usage.buckets, (modelId) =>
    modelId.includes('pro'),
  );
  const flashBucket = pickLowestRemainingBucket(usage.buckets, (modelId) =>
    modelId.includes('flash'),
  );

  return {
    pro: {
      key: 'pro',
      label: 'Pro',
      remainingPercent: proBucket?.remainingPercent ?? null,
      resetAt: proBucket?.resetAt ?? null,
    },
    flash: {
      key: 'flash',
      label: 'Flash',
      remainingPercent: flashBucket?.remainingPercent ?? null,
      resetAt: flashBucket?.resetAt ?? null,
    },
  };
}

export function formatGeminiUsageDollars(cents: number | null | undefined): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) {
    return '$0.00';
  }
  return `$${Math.max(cents, 0).toFixed(2)}`;
}

export function isGeminiAccountBanned(account: GeminiAccount): boolean {
  const status = (account.status || '').toLowerCase();
  const reason = (account.status_reason || '').toLowerCase();
  const is403Reason =
    reason.includes('status=403') ||
    reason.includes('403 forbidden') ||
    reason.includes('"code":403') ||
    reason.includes('"code": 403') ||
    reason.includes('permission_denied') ||
    reason.includes('caller does not have permission');
  return (
    status.includes('ban') ||
    status.includes('forbidden') ||
    reason.includes('ban') ||
    reason.includes('forbidden') ||
    reason.includes('suspend') ||
    is403Reason
  );
}
