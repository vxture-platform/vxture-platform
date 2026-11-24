/**
 * Atomic RP session operations for standalone Redis.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category persistence
 * @author AI-Generated
 * @date 2026-11-24
 */

// ============================================================================
// Session lifecycle: keep existing key names and never extend update TTLs.
// ============================================================================

export const CREATE_SESSION = `
if redis.call('exists', KEYS[3]) == 1 then return 0 end
if not redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX') then return 0 end
redis.call('sadd', KEYS[2], ARGV[3])
local lifetime = redis.call('pttl', KEYS[2])
local requested = tonumber(ARGV[2]) * 1000
if lifetime < requested then redis.call('pexpire', KEYS[2], requested) end
return 1`;

export const UPDATE_SESSION = `
if redis.call('exists', KEYS[2]) == 1 then return 0 end
if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[4] ~= '' and redis.call('get', KEYS[3]) ~= ARGV[4] then return 0 end
local lifetime = redis.call('pttl', KEYS[1])
if lifetime <= 0 then return 0 end
redis.call('set', KEYS[1], ARGV[2], 'PX', math.min(lifetime, tonumber(ARGV[3]) * 1000))
return 1`;

export const REVOKE_SESSION = `
redis.call('set', KEYS[2], '1', 'EX', ARGV[1])
local ids = redis.call('smembers', KEYS[1])
for _, id in ipairs(ids) do redis.call('del', ARGV[2] .. id) end
redis.call('del', KEYS[1])
return #ids`;

export const DESTROY_UNCHANGED_SESSION = `
if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('del', KEYS[1])
redis.call('srem', KEYS[2], ARGV[2])
return 1`;

// ============================================================================
// Refresh leases: stale holders cannot publish or release another holder's lock.
// ============================================================================

export const LOCK_REFRESH = `
if redis.call('exists', KEYS[2]) == 1 then return 0 end
if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('set', KEYS[3], ARGV[2], 'PX', ARGV[3], 'NX') and 1 or 0`;

export const RELEASE_REFRESH = `
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end
return 0`;
