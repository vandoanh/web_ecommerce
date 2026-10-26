"use client";

import Image from "next/image";
import { useRef, useState, type ChangeEvent } from "react";
import { storeApi } from "@/lib/store";

type ProductImagesFieldProps = {
  token: string;
  images: string[];
  onChange: (images: string[]) => void;
};

export function ProductImagesField({ token, images, onChange }: ProductImagesFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    setError("");
    if (!files.length) return;
    if (files.length + images.length > 10) {
      setError("Mỗi sản phẩm được thêm tối đa 10 ảnh.");
      return;
    }
    const tooLarge = files.find((file) => file.size > 8 * 1024 * 1024);
    if (tooLarge) {
      setError(`Ảnh “${tooLarge.name}” vượt quá 8 MB.`);
      return;
    }

    setUploading(true);
    try {
      const uploaded = await storeApi.uploadProductImages(token, files);
      onChange([...images, ...uploaded]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tải được ảnh lên.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="admin-product-images">
      <div className="admin-product-images-heading">
        <span>{images.length ? `${images.length} ảnh đã tải lên` : "Chưa có ảnh tải lên"}</span>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading || images.length >= 10}>
          {uploading ? "Đang tải ảnh…" : "Chọn ảnh"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          hidden
          onChange={(event) => void upload(event)}
        />
      </div>
      <small>JPEG, PNG, WebP hoặc GIF · tối đa 8 MB mỗi ảnh · tối đa 10 ảnh/sản phẩm</small>
      {error && <p className="admin-image-error" role="alert">{error}</p>}
      {images.length > 0 && (
        <div className="admin-product-image-grid">
          {images.map((image, index) => (
            <figure key={`${image}-${index}`}>
              <Image src={image} alt={`Ảnh sản phẩm ${index + 1}`} width={120} height={90} unoptimized />
              <button
                type="button"
                aria-label={`Xóa ảnh ${index + 1}`}
                onClick={() => onChange(images.filter((_, imageIndex) => imageIndex !== index))}
              >
                ×
              </button>
              {index === 0 && <figcaption>Ảnh đầu tiên</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
