import { DesktopNavbar } from "./DesktopNavbar";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileTopHeader } from "./MobileTopHeader";

const Header = () => {
  return (
    <>


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
