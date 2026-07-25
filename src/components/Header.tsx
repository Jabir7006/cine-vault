import { Link } from "@tanstack/react-router";

const Header = () => {
  return (
    <div>
      <Link to="/" activeOptions={{ exact: true }}>
        Home
      </Link>
      <Link to="/movies">Movies</Link>
      <Link to="/tv-shows">TV Shows</Link>
    </div>
  );
};

export default Header;
