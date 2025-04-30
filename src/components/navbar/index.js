import React, { useState } from 'react';
import './styles.css';

const Navbar = ({
  menus = [],
  menuActive,
  toggleMenuActive,
  toggleDarkMode,
  darkMode,
}) => {
  const [isNavActive, setIsNavActive] = useState(false);

  const handleToggle = () => {
    setIsNavActive(!isNavActive);
  };

  const handleLinkClick = (e, href) => {
    e.preventDefault();
    toggleMenuActive(href);
    setIsNavActive(false);
  };

  return (
    <nav className="jv-custom-nav">
      <div className="container">
        <div className="row">
          <button
            className={`jv-menu-button ${isNavActive ? 'active' : ''}`}
            onClick={handleToggle}
            aria-label="Toggle navigation"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>

          {isNavActive && (
            <div className="jv-menu-overlay active" onClick={handleToggle} />
          )}

          <ul className={`jv-nav-menu ${isNavActive ? 'active' : ''}`}>
            {menus.map((menu, i) => (
              <li
                className={`jv-nav-item ${
                  menuActive === menu.href ? 'active' : ''
                }`}
                key={i}
              >
                <a
                  className="jv-nav-link"
                  href={menu.href}
                  onClick={(e) => handleLinkClick(e, menu.href)}
                >
                  {menu.label}
                </a>
              </li>
            ))}
          </ul>

          <span className="jv-theme-toggle" onClick={toggleDarkMode}>
            {darkMode ? (
              <svg
                width="16"
                height="16"
                fill="currentColor"
                viewBox="0 0 16 16"
              >
                <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13a.5.5 0 0 1 0 1 .5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1 0-1 .5.5 0 0 1 0-1 .5.5 0 0 1-.46-.302l-.761-1.77a1.964 1.964 0 0 0-.453-.618A5.984 5.984 0 0 1 2 6zm6-5a5 5 0 0 0-3.479 8.592c.263.254.514.564.676.941L5.83 12h4.342l.632-1.467c.162-.377.413-.687.676-.941A5 5 0 0 0 8 1z" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                fill="currentColor"
                viewBox="0 0 16 16"
              >
                <path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13h-5a.5.5 0 0 1-.46-.302l-.761-1.77a1.964 1.964 0 0 0-.453-.618A5.984 5.984 0 0 1 2 6zm3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1-.5-.5z" />
              </svg>
            )}
          </span>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
