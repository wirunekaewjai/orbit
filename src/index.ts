/** @file library สำหรับเชื่อม type/interface เพื่อการเขียน Jinja บนไฟล์ JSX หรือ TSX [A minimalist type-safe bridge for writing Jinja templates via JSX/TSX] */

const ORBIT_BRANDED_SYMBOL = Symbol("orbit");

const ORBIT_EXPR_PREFIX = "@@@@@@@@:";
const ORBIT_EXPR_SUFFIX = ":########";
const ORBIT_EXPR_REGEX = new RegExp(`${ORBIT_EXPR_PREFIX}(.+?)${ORBIT_EXPR_SUFFIX}`, "g");

const toHex = (str: string) => {
  return Buffer.from(str, "utf8").toString("hex");
}

const fromHex = (hex: string) => {
  return Buffer.from(hex, "hex").toString("utf8");
}

// ป้องกันไม่ให้ JSX runtime ทำ HTML escape
const encode = (input: string) => {
  return `${ORBIT_EXPR_PREFIX}${toHex(input)}${ORBIT_EXPR_SUFFIX}`;
};

// แปลงค่าที่ encode เอาไว้กลับไปเป็น jinja syntax
export const decode = (input: string) => {
  return input.replaceAll(ORBIT_EXPR_REGEX, (_, capture) => {
    return fromHex(capture);
  });
};

export type OrbitValue<T> = {
  // branded type (ป้องกันไม่ให้นำ path จาก proxy ไปใช้กับ HTML Attribute โดยตรง อย่างน้อยต้องครอบ e(...), q(...) ก่อน)
  readonly [ORBIT_BRANDED_SYMBOL]: T;
};

export type OrbitBoolean = OrbitValue<boolean>;
export type OrbitNumber = OrbitValue<number>;
export type OrbitString = OrbitValue<string>;

export type OrbitArray<T> = OrbitValue<Array<T>> & {
  [index: number]: OrbitObject<T>;
};

export type OrbitObject<T> = (
  T extends string ? OrbitValue<string> :
  T extends number ? OrbitValue<number> :
  T extends boolean ? OrbitValue<boolean> :
  T extends Array<infer U> ? OrbitArray<U> :
  T extends object ? OrbitValue<object> & { readonly [key in keyof T]: OrbitObject<T[key]> } :
  never
);

export type OrbitProxyState = {
  path: string[];
};

/** @description helper function สำหรับสร้าง proxy object ที่เชื่อมกับ type/interface เพื่อในไปใช้กับ HTML Attribute หรือ innerHTML ร่วมกับ helper functions อื่นๆ เช่น e, q, b, json */
export const proxy = <T extends object>(state: OrbitProxyState = { path: [] }): OrbitObject<T> => {
  // ไม่ครอบ {{ }} เพราะจะได้เอาไปใช้ใน fn อื่นๆ ได้
  const render = () => {
    const tokens = state.path.map((p, i) => {
      if (p.match(/^[-]?\d+$/)) {
        return `[${p}]`;
      }

      if (i > 0) {
        return `.${p}`;
      }

      return p;
    });

    return tokens.join("");
  };

  return new Proxy({} as any, {
    get(target, prop, receiver) {
      // เวลา javascript runtime เป็นคนเรียกเพื่อพยายามอ่านค่าจะมาเข้าเงื่อนไขนี้ หรือเวลาครอบ String(...) ก็เช่นกัน
      if (prop === Symbol.toPrimitive || prop === "toString") {
        return () => render();
      }

      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }

      // สร้าง proxy object สำหรับ nested object
      return proxy({
        path: state.path.concat(prop),
      });
    },
  });
};

/** @description helper function สำหรับสร้าง block statement สำหรับ foreach */
export const map = <T>(array: OrbitArray<T>, as: string, callback: (value: OrbitObject<T>, index: OrbitNumber) => any): [string, any, string] => {
  // บอกให้ proxy handler ของ array ทำการ render path ออกมา
  const each = String(array);

  // loop.index0 เป็น jinja syntax
  const loop = proxy<{ index0: number }>({ path: ["loop"] });
  const item = proxy<never>({ path: [as] });

  // ไปตัดสินใจกันเอาเองว่าจะให้ jsx runtime จัดการเรื่อง children ให้อัตโนมัติ หรือจะ join เพื่อ debug
  return [
    encode(`{% for ${as} in ${each} %}`),
    callback(item, loop.index0),
    encode(`{% endfor %}`),
  ];
};

export type OrbitMatchState = {
  statements: any[];
};

// TODO: else condition and fix on jsx render
export const match = <T>(value: OrbitValue<T>, state: OrbitMatchState = { statements: [] }) => {
  const render = () => {
    if (state.statements.length) {
      return state.statements.join("") + encode("{% endif %}");
    }

    return "";
  };

  const push = (op: string, expected: T, then: any) => {
    const stmt = state.statements.length ? "elif" : "if";
    const exp = typeof expected === "string" ? `"${expected}"` : String(expected);

    state.statements.push(encode(`{% ${stmt} ${String(value)} ${op} ${exp} %}`), then);

    return match(value, state);
  };

  const createTarget = () => {
    return {
      [Symbol.toPrimitive]: () => render(),
      [Symbol.iterator]: function* () {
        yield* state.statements;

        if (state.statements.length) {
          yield encode("{% endif %}");
        }
      },
    };
  };

  const helper = {
    eq: (expected: T, then: any) => push("==", expected, then),
    ne: (expected: T, then: any) => push("!=", expected, then),
    gt: (expected: T, then: any) => push(">", expected, then),
    gte: (expected: T, then: any) => push(">=", expected, then),
    lt: (expected: T, then: any) => push("<", expected, then),
    lte: (expected: T, then: any) => push("<=", expected, then),

    between: (min: T, max: T, then: any) => {
      const stmt = state.statements.length ? "elif" : "if";

      const minExp = typeof min === "string" ? `"${min}"` : String(min);
      const maxExp = typeof max === "string" ? `"${max}"` : String(max);

      state.statements.push(encode(`{% ${stmt} ${String(value)} >= ${minExp} and ${String(value)} <= ${maxExp} %}`), then);

      return match(value, state);
    },

    else: (then: any) => {
      state.statements.push(encode(`{% else %}`), then);
      return createTarget();
    },
  };

  return {
    ...createTarget(),
    ...helper,
  };
};

/** @description helper function สำหรับครอบ {{ ... }} สำหรับ HTML attribute และ innerHTML */
export const e = <T>(value: OrbitValue<T>) => {
  return encode(`{{ ${String(value)} }}`);
};

/** @description helper function สำหรับครอบ "" และ {{ ... }} สำหรับ JSON value ที่เป็น string */
export const q = (value: OrbitValue<string>) => {
  return encode(`"{{ ${String(value)} }}"`);
};

/** @description helper function สำหรับครอบ {% ... %} ส่วน value อยากใส่อะไรก็ใส่ */
export const b = (value: `if ${string}` | `elif ${string}` | "else" | "endif") => {
  return encode(`{% ${value} %}`);
};

// ตอนนี้ยังไม่รองรับ array
export type OrbitJson = {
  [key: string]: string | number | boolean | OrbitJson;
};

/** @description helper function สำหรับสร้าง JSON string เพื่อทำ server-side props ใน Script Tag ที่เป็น JSON */
export const json = <T extends OrbitJson>(props: T): OrbitString => {
  const stringify = (input: OrbitJson) => {
    const entries: [string, string][] = [];

    if (Symbol.toPrimitive in input) {
      const fn = input[Symbol.toPrimitive];

      if (typeof fn === "function") {
        // บังคับให้ render() ใน proxy object ทำงาน
        return String(fn());
      }
    }

    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        entries.push([key, `${value}`]);
      }

      else if (value && typeof value === "object") {
        entries.push([key, stringify(value)]);
      }
    }

    return `{${entries.map(([key, value]) => `"${key}":${value}`).join(",")}}`;
  };

  // แปลงเป็น OrbitString จะได้ไม่เอาไปใช้มั่วซั่ว
  return stringify(props) as unknown as OrbitString;
};
