"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClientMenu } from "@/components/ClientMenu";
import { SharedFooter, SharedHeader } from "@/components/SharedChrome";
import { storeApi, type Contact } from "@/lib/store";
import "../store.css";

const EMPTY_FORM = { name: "", phone: "", address: "", mapLocation: "" };

function mapsQuery(mapLocation: string, address: string) {
  const match =
    mapLocation.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ??
    mapLocation.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ??
    mapLocation.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (match) return `${match[1]},${match[2]}`;
  if (mapLocation.trim() && !/^https?:\/\//i.test(mapLocation.trim())) return mapLocation.trim();
  return address.trim();
}

export default function ContactPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [previewQuery, setPreviewQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Contact | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreviewQuery(mapsQuery(form.mapLocation, form.address));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [form.address, form.mapLocation]);

  function updateField(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      const contact = await storeApi.createContact({
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        mapLocation: form.mapLocation.trim(),
      });
      setSaved(contact);
      setForm(EMPTY_FORM);
      setPreviewQuery("");
      formRef.current?.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không gửi được thông tin liên hệ.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="store-page store-contact-page">
      <div className="store-topbar">
        <span>ĐẶC SẢN GIÒ CHẢ &amp; PA-TÊ · HƯƠNG VỊ QUEN THUỘC</span>
        <span>Liên hệ để được tư vấn và giao hàng tận nhà</span>
      </div>
      <SharedHeader
        className="store-home-header"
        brandClassName="store-home-brand"
        logoClassName="store-home-logo"
        brandSize={72}
      >
        <ClientMenu current="contact" />
        <Link className="store-home-account-link store-contact-home-link" href="/">
          Về trang chủ
        </Link>
      </SharedHeader>

      <section className="store-contact-hero">
        <span className="store-kicker">LIÊN HỆ VỚI TUẤN KHANG</span>
        <h1>
          Gửi thông tin,
          <br />
          <em>nhận tư vấn tận tình.</em>
        </h1>
        <p>
          Để lại họ tên, số điện thoại, địa chỉ và vị trí Google Maps. Chúng tôi sẽ liên hệ lại để
          tư vấn món ngon và hỗ trợ giao hàng.
        </p>
      </section>

      <section className="store-contact-content">
        <div className="store-contact-grid">
          <div className="store-contact-card">
            {saved ? (
              <div className="store-contact-success" role="status">
                <span className="store-contact-check" aria-hidden="true">
                  ✓
                </span>
                <span className="store-kicker">ĐÃ LƯU THÔNG TIN</span>
                <h2>Cảm ơn {saved.name}!</h2>
                <p>Chúng tôi đã nhận được thông tin liên hệ và sẽ sớm gọi lại cho bạn.</p>
                <dl>
                  <div>
                    <dt>Số điện thoại</dt>
                    <dd>{saved.phone}</dd>
                  </div>
                  <div>
                    <dt>Địa chỉ</dt>
                    <dd>{saved.address}</dd>
                  </div>
                  {saved.mapLocation.startsWith("http") && (
                    <div>
                      <dt>Vị trí Google Maps</dt>
                      <dd>
                        <a href={saved.mapLocation} target="_blank" rel="noreferrer">
                          Mở vị trí đã gửi ↗
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
                <button
                  className="store-contact-submit"
                  type="button"
                  onClick={() => setSaved(null)}
                >
                  Gửi liên hệ khác <span>↗</span>
                </button>
              </div>
            ) : (
              <>
                <span className="store-kicker">THÔNG TIN LIÊN HỆ</span>
                <h2>Điền thông tin của bạn</h2>
                <p className="store-contact-intro">
                  Các trường đều bắt buộc. Thông tin được lưu an toàn để chúng tôi liên hệ lại.
                </p>
                {error && (
                  <p className="store-message store-error" role="alert">
                    {error}
                  </p>
                )}
                <form ref={formRef} className="store-contact-form" onSubmit={submit}>
                  <div className="store-contact-row">
                    <label>
                      Họ và tên
                      <input
                        name="name"
                        required
                        maxLength={255}
                        autoComplete="name"
                        placeholder="Nguyễn Văn An"
                        value={form.name}
                        onChange={(event) => updateField("name", event.target.value)}
                      />
                    </label>
                    <label>
                      Số điện thoại
                      <input
                        name="phone"
                        type="tel"
                        required
                        maxLength={32}
                        autoComplete="tel"
                        placeholder="0901 234 567"
                        value={form.phone}
                        onChange={(event) => updateField("phone", event.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    Địa chỉ
                    <textarea
                      name="address"
                      required
                      maxLength={2000}
                      rows={3}
                      autoComplete="street-address"
                      placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố"
                      value={form.address}
                      onChange={(event) => updateField("address", event.target.value)}
                    />
                  </label>
                  <label>
                    Vị trí Google Maps
                    <input
                      name="mapLocation"
                      required
                      maxLength={2048}
                      placeholder="Dán liên kết Google Maps hoặc toạ độ, ví dụ 10.7769,106.7009"
                      value={form.mapLocation}
                      onChange={(event) => updateField("mapLocation", event.target.value)}
                    />
                  </label>
                  <p className="store-contact-hint">
                    Mở Google Maps → chọn vị trí → <b>Chia sẻ</b> → <b>Sao chép liên kết</b> rồi dán
                    vào ô trên.
                  </p>
                  <button className="store-contact-submit" type="submit" disabled={sending}>
                    {sending ? "Đang gửi…" : "Gửi thông tin"} <span>↗</span>
                  </button>
                </form>
              </>
            )}
          </div>

          <aside className="store-contact-map" aria-label="Bản đồ vị trí liên hệ">
            <span className="store-kicker">VỊ TRÍ TRÊN GOOGLE MAPS</span>
            <h2>Xem trước vị trí</h2>
            {previewQuery ? (
              <iframe
                key={previewQuery}
                title="Bản đồ vị trí liên hệ"
                src={`https://www.google.com/maps?q=${encodeURIComponent(previewQuery)}&output=embed`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            ) : (
              <div className="store-contact-map-empty">
                <span aria-hidden="true">⌖</span>
                <p>Dán liên kết Google Maps hoặc nhập địa chỉ để xem trước vị trí trên bản đồ.</p>
              </div>
            )}
            <p className="store-contact-map-note">
              Bản đồ hiển thị theo thông tin bạn nhập. Hãy kiểm tra vị trí trước khi gửi để chúng
              tôi giao hàng chính xác.
            </p>
          </aside>
        </div>
      </section>

      <SharedFooter className="store-footer store-home-footer">
        <Link className="store-brand" href="/">
          Tuấn Khang
        </Link>
        <span>Thêm món ngon, ấm vị bữa cơm nhà.</span>
        <Link href="/#products">Xem thực đơn</Link>
      </SharedFooter>
    </main>
  );
}
