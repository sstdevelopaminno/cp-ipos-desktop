import { convertFileSrc } from "@tauri-apps/api/core";

const EXTERNAL_SRC = /^(?:data:|blob:|https?:|asset:|http:\/\/asset\.localhost)/i;
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;
const UNC_PATH = /^\\\\/;

export function productImageSrc(path?: string | null) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (EXTERNAL_SRC.test(value)) return value;

  const isTauri =
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

  if (isTauri && (WINDOWS_PATH.test(value) || UNC_PATH.test(value) || value.startsWith("/"))) {
    try {
      return convertFileSrc(value);
    } catch {
      return value;
    }
  }

  return value.replace(/\\/g, "/");
}

export async function browserImageDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("IMAGE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}
