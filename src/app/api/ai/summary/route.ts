import { NextResponse } from "next/server";

import {
  buildBusinessSnapshot,
} from "@/lib/ai/business-snapshot";

import {
  createOpenAIClient,
  getOpenAIModel,
} from "@/lib/ai/openai";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

import {
  createClient,
} from "@/lib/supabase/server";

export async function POST() {
  const supabase =
    await createClient();

  const {
    data: { user },
    error: authError,
  } =
    await supabase.auth.getUser();

  if (
    authError ||
    !user
  ) {
    return NextResponse.json(
      {
        error:
          "กรุณาเข้าสู่ระบบ",
      },
      {
        status: 401,
      },
    );
  }

  const admin =
    createAdminClient();

  const {
    data: allowed,
    error: permissionError,
  } =
    await admin.rpc(
      "user_has_permission",
      {
        p_user_id:
          user.id,

        requested_permission:
          "ai.use",
      },
    );

  if (permissionError) {
    console.error(
      "AI permission check failed:",
      permissionError,
    );

    return NextResponse.json(
      {
        error:
          "ไม่สามารถตรวจสอบสิทธิ์ AI ได้",
      },
      {
        status: 500,
      },
    );
  }

  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "บัญชีนี้ไม่มีสิทธิ์ใช้งาน AI",
      },
      {
        status: 403,
      },
    );
  }

  try {
    const snapshot =
      await buildBusinessSnapshot();

    const openai =
      createOpenAIClient();

    const model =
      getOpenAIModel();

    const response =
      await openai.responses.create({
        model,

        store: false,

        max_output_tokens:
          800,

        instructions: `
คุณคือ AI Business Analyst สำหรับเจ้าของร้านอาหาร

คุณได้รับข้อมูลจากระบบ Restaurant Stock ที่ผ่านการคำนวณจากฐานข้อมูลแล้ว

กฎสำคัญ:
- วิเคราะห์เฉพาะข้อมูลที่ได้รับเท่านั้น
- ห้ามแต่งตัวเลขขึ้นเอง
- ห้ามรวมสินค้าที่มีหน่วยต่างกัน เช่น g, ml, pcs
- current_quantity, reorder_point และ stock_status จากฐานข้อมูลเป็น Source of Truth
- ถ้าข้อมูลไม่เพียงพอ ต้องบอกว่า "ข้อมูลยังไม่เพียงพอ"
- ห้ามคาดการณ์วัน Stock หมด ถ้าไม่มีข้อมูลอัตราการใช้
- ห้ามอ้างยอดขาย กำไร Food Cost หรือ Inventory Value ถ้าไม่มีข้อมูลดังกล่าว
- อย่าแนะนำให้สั่งซื้อสินค้าเพียงเพราะมี Waste ถ้า Stock ปัจจุบันยังเพียงพอ
- AI มีหน้าที่วิเคราะห์เท่านั้น ไม่มีอำนาจแก้ไขข้อมูล
- ตอบภาษาไทย
- ใช้ภาษาที่เจ้าของร้านเข้าใจง่าย
- กระชับ แต่ต้องมีเหตุผลจากข้อมูลจริง

กฎด้านความปลอดภัยของวัตถุดิบ:
- ห้ามแนะนำให้นำวัตถุดิบที่หมดอายุแล้วมาใช้
- ถ้าแนะนำเรื่องการหมุนเวียน Stock ให้ใช้แนวคิด FEFO คือใช้วัตถุดิบที่ใกล้หมดอายุก่อน
- ถ้าไม่มีข้อมูลวันหมดอายุจริง ห้ามอ้างว่าวัตถุดิบรายการใดกำลังจะหมดอายุ

รูปแบบคำตอบ:
ใช้ Plain Text เท่านั้น
ห้ามใช้ Markdown heading, ตัวหนา, code block หรือ Markdown Table

ภาพรวม:
สรุปสถานการณ์ร้าน 1-2 ประโยค

สิ่งที่ควรสนใจ:
- 2 ถึง 4 ข้อ
- ระบุตัวเลขและหน่วยเมื่อข้อมูลรองรับ

คำแนะนำ:
- 1 ถึง 3 ข้อที่นำไปทำได้จริง

ข้อจำกัด:
ระบุเฉพาะข้อจำกัดของข้อมูลที่มีผลต่อการวิเคราะห์
`.trim(),

        input:
          JSON.stringify(
            snapshot,
          ),
      });

    const summary =
      response.output_text.trim();

    if (!summary) {
      throw new Error(
        "AI returned an empty response.",
      );
    }

    return NextResponse.json({
      summary,

      model,

      generated_at:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "AI summary generation failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "ไม่สามารถวิเคราะห์ข้อมูลด้วย AI ได้ในขณะนี้",
      },
      {
        status: 500,
      },
    );
  }
}