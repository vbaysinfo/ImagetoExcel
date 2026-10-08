import type { Metadata } from "next";
import { TemplateAdmin } from "@/components/sketch/TemplateAdmin";

export const metadata: Metadata = { title: "Excel template setup" };

export default function TemplateAdminPage() {
  return <TemplateAdmin />;
}
