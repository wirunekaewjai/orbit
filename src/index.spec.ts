import { describe, expect, test } from "bun:test";
import { b, decode, e, json, map, match, proxy, q } from ".";

type MyObject = {
  a: boolean;
  b: number;
  c: string;
  d: boolean[];
  e: {
    nested: string;
  };
  f: Array<{
    nested: boolean;
  }>;
  g: {
    array: Array<{
      value: number;
    }>;
  };
};

describe("orbit", () => {
  test("should return a valid path", () => {
    const o = proxy<MyObject>();

    expect(String(o.a)).toBe("a");
    expect(String(o.b)).toBe("b");
    expect(String(o.c)).toBe("c");
    expect(String(o.d)).toBe("d");
    expect(String(o.e)).toBe("e");
    expect(String(o.e.nested)).toBe("e.nested");
    expect(String(o.f[-1]!.nested)).toBe("f[-1].nested");
    expect(String(o.f[0]!.nested)).toBe("f[0].nested");
    expect(String(o.f[1]!.nested)).toBe("f[1].nested");
    expect(String(o.f[99999]!.nested)).toBe("f[99999].nested");
    expect(String(o.g.array[0]!.value)).toBe("g.array[0].value");
  });

  test("should return a valid expression", () => {
    const o = proxy<MyObject>();

    expect(decode(e(o.a))).toBe("{{ a }}");
    expect(decode(e(o.g.array[0]!.value))).toBe("{{ g.array[0].value }}");
  });

  test("should return a valid block", () => {
    const o = proxy<MyObject>();

    expect(decode(b(`if ${o.b} >= 10 && ${o.c} === 'test'`))).toBe("{% if b >= 10 && c === 'test' %}");
    expect(decode(b(`elif ${o.b} >= 10 && ${o.c} !== "test"`))).toBe('{% elif b >= 10 && c !== "test" %}');
    expect(decode(b(`else`))).toBe("{% else %}");
    expect(decode(b(`endif`))).toBe("{% endif %}");
  });

  test("should return a valid foreach", () => {
    const o = proxy<MyObject>();

    expect(decode(map(o.d, "a", (v, i) => `${e(v)}: ${e(i)}`).join(""))).toBe("{% for a in d %}{{ a }}: {{ loop.index0 }}{% endfor %}");
    expect(decode(map(o.f, "b", (v, i) => `${e(v.nested)}: ${e(i)}`).join(""))).toBe("{% for b in f %}{{ b.nested }}: {{ loop.index0 }}{% endfor %}");
  });

  test("should return a valid json", () => {
    const o = proxy<MyObject>();
    const j = json({
      a: e(o.a),
      b: e(o.b),
      c: q(o.c),
      e: {
        nested: q(o.e.nested),
      },
    });

    expect(decode(String(j))).toBe('{"a":{{ a }},"b":{{ b }},"c":"{{ c }}","e":{"nested":"{{ e.nested }}"}}');
  });

  test("should return a valid match", () => {
    const o = proxy<MyObject>();
    const m1 = match(o.c)
      .eq("1", "v1")
      .ne("2", "v2")
      .between("3", "4", "3 to 4")
      .else("default");

    expect(decode(String(m1))).toBe('{% if c == "1" %}v1{% elif c != "2" %}v2{% elif c >= "3" and c <= "4" %}3 to 4{% else %}default{% endif %}');

    const m2 = match(o.c)
      .eq("1", "v1")
      .ne("2", "v2");

    expect(decode(String(m2))).toBe('{% if c == "1" %}v1{% elif c != "2" %}v2{% endif %}');

    const m3 = match(o.c);

    expect(decode(String(m3))).toBe('');
  });
});
