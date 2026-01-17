/** @file library สำหรับเชื่อม type/interface เพื่อการเขียน Jinja บนไฟล์ JSX หรือ TSX [A minimalist type-safe bridge for writing Jinja templates via JSX/TSX] */

const BRANDED_SYMBOL = Symbol("pin");

const PREFIX = "@@@@@@@@:";
const SUFFIX = ":########";
const REGEX = new RegExp(`${PREFIX}(.+?)${SUFFIX}`, "g");

const toHex = (str: string) => {
  return Buffer.from(str, "utf8").toString("hex");
}

const fromHex = (hex: string) => {
  return Buffer.from(hex, "hex").toString("utf8");
}

// ป้องกันไม่ให้ JSX runtime ทำ HTML escape
const pin = (input: string) => {
  return `${PREFIX}${toHex(input)}${SUFFIX}`;
};

// แปลงค่าที่ encode (pin) เอาไว้กลับไปเป็น Jinja syntax
export const unpin = <T>(input: T) => {
  return String(input).replaceAll(REGEX, (_, capture) => {
    return fromHex(capture);
  });
};

export type PinValue<T> = {
  // branded type (ป้องกันไม่ให้นำ path จาก proxy ไปใช้กับ HTML Attribute โดยตรง อย่างน้อยต้องครอบ e(...), q(...) ก่อน)
  readonly [BRANDED_SYMBOL]: T;
};

export type PinBoolean = PinValue<boolean>;
export type PinNumber = PinValue<number>;
export type PinString = PinValue<string>;

export type PinArray<T> = PinValue<Array<T>> & {
  [index: number]: PinObject<T>;
};

export type PinObject<T> = (
  T extends string ? PinValue<string> :
  T extends number ? PinValue<number> :
  T extends boolean ? PinValue<boolean> :
  T extends Array<infer U> ? PinArray<U> :
  T extends object ? PinValue<object> & { readonly [key in keyof T]: PinObject<T[key]> } :
  never
);

export type PinProxyState = {
  path: string[];
};

/** @description helper function สำหรับสร้าง proxy object ที่เชื่อมกับ type/interface เพื่อในไปใช้กับ HTML Attribute หรือ innerHTML ร่วมกับ helper functions อื่นๆ เช่น e, q, b, json */
export const proxy = <T extends object>(state: PinProxyState = { path: [] }): PinObject<T> => {
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
export const map = <T>(array: PinArray<T>, as: string, callback: (value: PinObject<T>, index: PinNumber) => any): [string, any, string] => {
  // บอกให้ proxy handler ของ array ทำการ render path ออกมา
  const each = String(array);

  // loop.index0 เป็น Jinja syntax
  const loop = proxy<{ index0: number }>({ path: ["loop"] });
  const item = proxy<never>({ path: [as] });

  // ไปตัดสินใจกันเอาเองว่าจะให้ jsx runtime จัดการเรื่อง children ให้อัตโนมัติ หรือจะ join เพื่อ debug
  return [
    pin(`{% for ${as} in ${each} %}`),
    callback(item, loop.index0),
    pin(`{% endfor %}`),
  ];
};

export type PinMatchState = {
  statements: any[];
};

export const match = <T>(value: PinValue<T>, state: PinMatchState = { statements: [] }) => {
  const render = () => {
    if (state.statements.length) {
      return state.statements.join("") + pin("{% endif %}");
    }

    return "";
  };

  const push = (op: string, expected: T, then: any) => {
    const stmt = state.statements.length ? "elif" : "if";
    const exp = typeof expected === "string" ? `"${expected}"` : String(expected);

    state.statements.push(pin(`{% ${stmt} ${String(value)} ${op} ${exp} %}`), then);

    return match(value, state);
  };

  const createTarget = () => {
    return {
      [Symbol.toPrimitive]: () => render(),
      [Symbol.iterator]: function* () {
        yield* state.statements;

        if (state.statements.length) {
          yield pin("{% endif %}");
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

      state.statements.push(pin(`{% ${stmt} ${String(value)} >= ${minExp} and ${String(value)} <= ${maxExp} %}`), then);

      return match(value, state);
    },

    else: (then: any) => {
      state.statements.push(pin(`{% else %}`), then);
      return createTarget();
    },
  };

  return {
    ...createTarget(),
    ...helper,
  };
};

/** @description helper function สำหรับครอบ {{ ... }} สำหรับ HTML attribute, innerHTML, JSON value, หรือ JSX Prop โดยที่จะหลอก IDE ว่าคืนค่า type เดิมกลับไป (ถ้าใช้เป็น JSX Prop ไม่ควรนำค่านั้นไปใช้คำนวณหรือเช็คเงื่อนไขต่างๆ ในช่วง prerender เพราะค่ามันจะไม่ใช่ value จริงๆ) */
export const e = <T>(value: PinValue<T>): T => {
  return pin(`{{ ${String(value)} }}`) as T;
};

/** @description helper function สำหรับครอบ "" และ {{ ... }} สำหรับ JSON value ที่เป็น string */
export const q = (value: PinValue<string>): string => {
  return pin(`"{{ ${String(value)} }}"`);
};

/** @description helper function สำหรับครอบ {% ... %} ส่วน value อยากใส่อะไรก็ใส่ */
export const b = (value: `if ${string}` | `elif ${string}` | "else" | "endif"): string => {
  return pin(`{% ${value} %}`);
};

// ตอนนี้ยังไม่รองรับ array
export type PinJson = {
  [key: string]: string | number | boolean | PinJson;
};

/** @description helper function สำหรับสร้าง JSON string เพื่อทำ server-side props ใน Script Tag ที่เป็น JSON */
export const json = <T extends PinJson>(props: T): PinString => {
  const stringify = (input: PinJson) => {
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

  // แปลงเป็น PinString จะได้ไม่เอาไปใช้มั่วซั่ว
  return stringify(props) as unknown as PinString;
};
