import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";

interface KlingResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface KlingTaskData {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg: string;
  task_result: {
    images?: { url: string }[];
  };
}

export class KlingImageProvider implements AIProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = params?.apiKey || process.env.KLING_API_KEY || "";
    this.baseUrl = (params?.baseUrl || "https://api.klingai.com").replace(/\/+$/, "");
    this.model = params?.model || "kling-v1";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(_prompt: string, _options?: TextOptions): Promise<string> {
    throw new Error("Kling does not support text generation");
  }

  async generateImage(prompt: string, _options?: ImageOptions): Promise<string> {
    // Submit task
    const submitRes = await fetch(`${this.baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        n: 1,
        aspect_ratio: "16:9",
      }),
    });

    if (!submitRes.ok) {
      throw new Error(`Kling image submit failed: ${submitRes.status}`);
    }

    const submitJson = (await submitRes.json()) as KlingResponse<{ task_id: string }>;
    if (submitJson.code !== 0) {
      throw new Error(`Kling image error: ${submitJson.message}`);
    }

    const taskId = submitJson.data.task_id;
    console.log(`[Kling Image] Task submitted: ${taskId}`);

    // Poll for result
    const imageUrl = await this.pollForResult(taskId);

    // Download to local storage
    const imageRes = await fetch(imageUrl);
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const ext = imageUrl.split("?")[0].split(".").pop() || "png";
    const filename = `${ulid()}.${ext}`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`[Kling Image] Saved to ${filepath}`);
    return filepath;
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 60;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));

      const res = await fetch(`${this.baseUrl}/v1/images/generations/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        throw new Error(`Kling image poll failed: ${res.status}`);
      }

      const json = (await res.json()) as KlingResponse<KlingTaskData>;

      if (json.code !== 0) {
        throw new Error(`Kling image poll error: ${json.message}`);
      }

      const { task_status, task_status_msg, task_result } = json.data;
      console.log(`[Kling Image] Poll ${i + 1}: status=${task_status}`);

      if (task_status === "succeed") {
        const url = task_result.images?.[0]?.url;
        if (!url) throw new Error("Kling image: no URL in result");
        return url;
      }

      if (task_status === "failed") {
        throw new Error(`Kling image generation failed: ${task_status_msg}`);
      }
    }

    throw new Error("Kling image generation timed out after 5 minutes");
  }
}
