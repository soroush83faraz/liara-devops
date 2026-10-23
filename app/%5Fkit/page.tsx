// Visual-check route (served at /_kit; the folder is %5Fkit because a plain leading underscore makes a private folder).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Kit } from "./kit";

export const metadata: Metadata = { title: "UI kit", robots: { index: false } };

export default function KitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Kit />;
}
