"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

type RichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

const toolbarItems = [
  { label: "Đậm", title: "In đậm", action: (editor: NonNullable<ReturnType<typeof useEditor>>) => editor.chain().focus().toggleBold().run(), active: (editor: NonNullable<ReturnType<typeof useEditor>>) => editor.isActive("bold") },
  { label: "Nghiêng", title: "In nghiêng", action: (editor: NonNullable<ReturnType<typeof useEditor>>) => editor.chain().focus().toggleItalic().run(), active: (editor: NonNullable<ReturnType<typeof useEditor>>) => editor.isActive("italic") },
  { label: "H2", title: "Tiêu đề", action: (editor: NonNullable<ReturnType<typeof useEditor>>) => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: (editor: NonNullable<ReturnType<typeof useEditor>>) => editor.isActive("heading", { level: 2 }) },
  { label: "• Danh sách", title: "Danh sách", action: (editor: NonNullable<ReturnType<typeof useEditor>>) => editor.chain().focus().toggleBulletList().run(), active: (editor: NonNullable<ReturnType<typeof useEditor>>) => editor.isActive("bulletList") },
  { label: "1. Danh sách", title: "Danh sách đánh số", action: (editor: NonNullable<ReturnType<typeof useEditor>>) => editor.chain().focus().toggleOrderedList().run(), active: (editor: NonNullable<ReturnType<typeof useEditor>>) => editor.isActive("orderedList") },
];

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"] }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "admin-rich-text-content",
        "aria-label": "Nội dung mô tả sản phẩm",
      },
    },
    onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getHTML()),
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== (value || "<p></p>")) {
      editor.commands.setContent(value || "<p></p>", { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div className="admin-rich-text-editor">
      <div className="admin-rich-text-toolbar" aria-label="Định dạng mô tả">
        {editor && toolbarItems.map((item) => (
          <button
            key={item.label}
            type="button"
            title={item.title}
            aria-pressed={item.active(editor)}
            className={item.active(editor) ? "active" : ""}
            onClick={() => item.action(editor)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          title="Thêm hoặc sửa liên kết"
          onClick={() => {
            if (!editor) return;
            const current = editor.getAttributes("link").href as string | undefined;
            const address = window.prompt("Nhập địa chỉ liên kết (http/https):", current ?? "https://");
            if (address === null) return;
            const trimmed = address.trim();
            if (!trimmed) editor.chain().focus().unsetLink().run();
            else editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
          }}
        >
          Liên kết
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
