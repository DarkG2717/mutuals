/**
 * MUTUALS — bottom navigation.
 *
 * One pattern for the whole app: Discover · Messages · Profile. Injected rather
 * than pasted into each page so a new screen cannot drift into its own
 * navigation, and so the active item is derived from the URL instead of being
 * hand-maintained (the old header nav marked "Profile" active on profile.html
 * and nothing anywhere else).
 *
 * Opt in per page:
 *   <link rel="stylesheet" href="../assets/css/bottom-nav.css">
 *   <script src="../assets/js/bottom-nav.js" defer></script>
 */

(function () {
  const ITEMS = [
    { file: "discover.html", label: "Discover", icon: "✦" },
    { file: "messages.html", label: "Messages", icon: "✳" },
    { file: "profile.html", label: "Profile", icon: "◍" }
  ];

  function currentFile() {
    const path = window.location.pathname.split("/").pop();
    return path || "index.html";
  }

  function build() {
    if (document.querySelector(".bottom-nav")) return;

    const nav = document.createElement("nav");
    nav.className = "bottom-nav";
    nav.setAttribute("aria-label", "Main");

    const here = currentFile();

    ITEMS.forEach(item => {
      const link = document.createElement("a");
      link.href = item.file;

      const isActive = here === item.file;
      if (isActive) {
        link.className = "active";
        link.setAttribute("aria-current", "page");
      }

      const icon = document.createElement("span");
      icon.className = "nav-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = item.icon;

      const label = document.createElement("span");
      label.textContent = item.label;

      link.append(icon, label);
      nav.appendChild(link);
    });

    document.body.appendChild(nav);
    document.body.classList.add("has-bottom-nav");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
