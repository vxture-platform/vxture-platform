/**
 * Model atomic RP operations for HTTP tests; real Lua is covered by Redis integration tests.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-25
 */
export function sessionTestEval(
  values: Map<string, string>,
  members = new Map<string, Set<string>>(),
) {
  return async (
    script: string,
    count: number,
    ...input: (string | number)[]
  ) => {
    const keys = input.slice(0, count).map(String);
    const args = input.slice(count).map(String);
    const key = keys[0]!;
    if (script.includes("local requested")) {
      if (values.has(keys[2]!) || values.has(key)) return 0;
      values.set(key, args[0]!);
      const set = members.get(keys[1]!) ?? new Set<string>();
      set.add(args[2]!);
      members.set(keys[1]!, set);
      return 1;
    }
    if (script.includes("math.min(lifetime")) {
      if (
        values.has(keys[1]!) ||
        values.get(key) !== args[0] ||
        (args[3] && values.get(keys[2]!) !== args[3])
      )
        return 0;
      values.set(key, args[1]!);
      return 1;
    }
    if (script.includes("'srem'")) {
      if (values.get(key) !== args[0]) return 0;
      values.delete(key);
      members.get(keys[1]!)?.delete(args[1]!);
      return 1;
    }
    if (script.includes("local ids")) {
      values.set(keys[1]!, "1");
      const ids = members.get(key) ?? new Set<string>();
      for (const id of ids) values.delete(args[1]! + id);
      members.delete(key);
      return ids.size;
    }
    if (count === 3 && script.includes("'NX'")) {
      if (
        values.has(keys[1]!) ||
        values.get(key) !== args[0] ||
        values.has(keys[2]!)
      )
        return 0;
      values.set(keys[2]!, args[1]!);
      return 1;
    }
    if (count === 1 && script.includes("'del'")) {
      if (values.get(key) !== args[0]) return 0;
      values.delete(key);
      return 1;
    }
    throw new Error("Unsupported Redis script in HTTP fixture");
  };
}
