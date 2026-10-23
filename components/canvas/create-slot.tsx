// The create unit's «+ افزودن» menu (network / app / database wizards). `hasCreateMenu` tells the canvas it no longer
// needs its disabled placeholder CTA.
import { CreateMenu } from "@/components/create/create-menu";

export const hasCreateMenu = true;

export function CreateMenuSlot() {
  return <CreateMenu />;
}
