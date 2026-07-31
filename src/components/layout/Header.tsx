import { DesktopNavbar } from "./DesktopNavbar";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileTopHeader } from "./MobileTopHeader";

const Header = () => {
  return (
    <>
      {/* Top Gradient Ambient Blur Mask */}
      <div className="fixed top-0 inset-x-0 h-32 bg-linear-to-b from-black/90 via-black/40 to-transparent pointer-events-none z-40" />

      {/* Bottom Mobile Gradient Ambient Blur Mask */}
      <div className="fixed bottom-0 inset-x-0 h-32 bg-linear-to-t from-black/95 via-black/50 to-transparent pointer-events-none z-40 md:hidden" />

      {/* Desktop Navigation */}
      <DesktopNavbar />

      {/* Mobile Top & Bottom Navigation */}
      <MobileTopHeader />
      <MobileBottomNav />
    </>
  );
};

export default Header;
export { NAV_ITEMS, type NavItem } from "@/config/navigation";
