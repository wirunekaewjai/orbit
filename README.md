# orbit

โปรเจกต์นี้เริ่มมาจากการฝึกพัฒนาเว็บไซต์ด้วยภาษา **Rust** โดยในช่วงแรกนั้นใช้ [Askama](https://github.com/askama-rs/askama) ในการแสดงผล HTML ซึ่งทำให้ได้ศึกษาการเขียน Jinja Syntax ลงบนไฟล์ HTML อย่างไรก็ตาม ด้วยความคุ้นชินจากการพัฒนา UI ด้วย JSX/TSX จึงเกิดแนวคิดในการเชื่อมต่อทั้งสองฝั่งเข้าด้วยกัน คือการพัฒนา Core logic ด้วย Rust และออกแบบ UI ด้วยความคล่องตัวของ JSX

**orbit** จึงถูกพัฒนาขึ้นเพื่อเป็น minimalist type-safe bridge สำหรับเขียน Jinja template ผ่านไฟล์ TSX โดยตรง ช่วยรักษาความถูกต้องของ Type และแก้ไขปัญหาการถูกแทรกแซง (escape) syntax โดย JSX runtime

---

## ปรัชญาการออกแบบ (Design Philosophy)

**orbit** ถูกออกแบบโดยยึดถือหลักความเรียบง่าย (Simplicity) เป็นสำคัญ เพื่อทำหน้าที่เป็นเพียง "สะพานเชื่อม" ระหว่างสองระบบเท่านั้น โดยมีข้อกำหนดขอบเขตดังนี้:

* **Minimalist Bridge:** โฟกัสเฉพาะการส่งต่อข้อมูลและโครงสร้างพื้นฐาน ไม่มีการเพิ่มฟีเจอร์ซับซ้อนของ Jinja เช่น `filter`, `macro`, `extends` หรือ `include`
* **Server-Side Logic:** ในกรณีที่มีลอจิกที่ซับซ้อน แนะนำให้ดำเนินการให้เสร็จสิ้นที่ฝั่ง Server (เช่น ในโค้ด Rust) ก่อนจะส่งค่ามายัง Template เพื่อรักษาความสะอาดของ UI Code
* **Type-Safety First:** เน้นการใช้ประโยชน์จาก TypeScript เพื่อป้องกันความผิดพลาดในการเข้าถึงข้อมูล (Data access)

---

## คุณสมบัติหลัก

* **Bridge the Gap:** ออกแบบ UI ด้วย JSX แต่ได้ผลลัพธ์เป็น Jinja template สำหรับโปรเจกต์ Rust หรือภาษาอื่นๆ ที่รองรับ
* **Type-safe Template:** ใช้ TypeScript Interface ในการทำ Autocomplete และตรวจสอบความถูกต้องของตัวแปร ลดความผิดพลาดจากการสะกดชื่อตัวแปรผิด
* **No More Escaping Issues:** มีระบบ Encoding/Decoding ภายใน เพื่อป้องกันไม่ให้เครื่องหมายอย่าง `{{` หรือ `{%` ถูก JSX runtime เปลี่ยนเป็น HTML entities

---

## ขั้นตอนการใช้งาน

### 1. นิยาม Interface และสร้าง Proxy

สร้าง object ที่เป็นตัวแทนของข้อมูลใน Jinja โดยอ้างอิงโครงสร้างจาก Interface

```typescript
import { proxy, e, decode } from "orbit";

interface Post {
  id: number;
  title: string;
  content: string;
  tags: string[];
}

const post = proxy<Post>();

```

### 2. ออกแบบ Template ด้วย TSX

ใช้กลุ่มฟังก์ชัน helper เพื่อสร้าง syntax ของ Jinja ภายในโครงสร้าง JSX

```tsx
import { map, match, e } from "orbit";

const PostTemplate = () => (
  <article>
    {/* e() ย่อมาจาก expression สำหรับสร้าง {{ ... }} */}
    <h1>{e(post.title)}</h1>
    
    <div className="tags">
      {/* map() สำหรับสร้าง {% for ... %} */}
      {map(post.tags, "tag", (tag) => (
        <span className="tag-item">{e(tag)}</span>
      ))}
    </div>

    <p>{e(post.content)}</p>
    
    {/* match() สำหรับการทำ conditional logic แบบ chaining */}
    {match(post.id)
      .eq(1, <span>Featured Post</span>)
      .else(<span>Standard Post</span>)}
  </article>
);

```

ในกรณีที่ต้องการควบคุม Logic แบบ Manual สามารถใช้ฟังก์ชัน `b()` (Block) ได้:

```tsx
import { b, proxy } from 'orbit';

const user = proxy<{ isLoggedIn: boolean; role: string }>();

const Header = () => (
  <nav>
    {/* เริ่มต้น Block if */}
    {b(`if ${user.isLoggedIn}`)}
      <span>ยินดีต้อนรับกลับ!</span>
      
    {/* เงื่อนไข elif */}
    {b(`elif ${user.role} == "admin"`)}
      <a href="/admin">Dashboard</a>
      
    {/* เงื่อนไข else */}
    {b("else")}
      <a href="/login">เข้าสู่ระบบ</a>
        
    {/* ปิดท้ายด้วย endif */}
    {b("endif")}
  </nav>
);

```

### 3. การ Decode เพื่อนำไปใช้งาน

แปลงผลลัพธ์จาก JSX string ให้กลับมาเป็น Jinja syntax ที่สมบูรณ์

```tsx
import { renderToString } from 'react-dom/server';
import { decode } from 'orbit';

const html = renderToString(<Header />);
const finalJinja = decode(html); 

```

**ตัวอย่างผลลัพธ์ที่ได้ (Jinja Template):**

```html
<nav>
  {% if isLoggedIn %}
    <span>ยินดีต้อนรับกลับ!</span>
  {% elif role == "admin" %}
    <a href="/admin">Dashboard</a>
  {% else %}
    <a href="/login">เข้าสู่ระบบ</a>
  {% endif %}
</nav>

```

---

## API Reference

| Helper | คำอธิบาย |
| --- | --- |
| `proxy<T>()` | สร้าง Proxy object เพื่อเข้าถึง path ตามโครงสร้างของ `T` |
| `e(value)` | สร้าง Expression `{{ value }}` |
| `q(value)` | สร้าง String expression `"{{ value }}"` สำหรับค่าใน JSON |
| `b(statement)` | เขียน Block ตรงๆ เช่น `{% if ... %}` หรือ `{% endif %}` |
| `map(arr, as, cb)` | สร้าง Loop `{% for item in array %}` |
| `match(value)` | สร้าง Chaining logic สำหรับ `if`, `elif`, `else` |
| `json(obj)` | แปลง Object เป็น JSON string ที่มี Jinja expression อยู่ภายใน |
| `decode(html)` | ฟังก์ชันสำคัญสำหรับแปลง internal markers กลับเป็น Jinja syntax |

---

## หมายเหตุ

โปรเจกต์นี้พัฒนาขึ้นเพื่อใช้งานในโปรเจกต์ส่วนตัวเป็นหลัก แต่หากคุณพบว่ามีประโยชน์ต่อ Workflow ของคุณ ก็สามารถนำไปใช้งานได้ตามสบายครับ

**License**: MIT

---
