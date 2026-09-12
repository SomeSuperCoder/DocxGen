import { lazy, Suspense } from "react";
import { Landing } from "./components/Landing";
import { SiteHeader } from "./components/SiteHeader";
import { useHashRoute } from "./lib/useHashRoute";

const DocumentGenerator = lazy(() =>
  import("./components/DocumentGenerator").then((module) => ({
    default: module.DocumentGenerator,
  })),
);

function App() {
  const { route, navigate } = useHashRoute();
  const goToApp = () => navigate("app");
  const goHome = () => navigate("landing");

  return (
    <div className="min-h-dvh bg-background">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById("main-content");
          main?.focus({ preventScroll: true });
          main?.scrollIntoView({ block: "start" });
        }}
      >
        Перейти к содержимому
      </a>
      <SiteHeader
        variant={route === "landing" ? "landing" : "app"}
        onStart={goToApp}
        onHome={goHome}
      />
      {route === "landing" ? (
        <Landing onStart={goToApp} />
      ) : (
        <main id="main-content" tabIndex={-1} className="workspace-main">
          <Suspense
            fallback={
              <div
                className="site-container"
                role="status"
                aria-label="Загрузка редактора"
              >
                <div className="editor-skeleton-title" />
                <div className="editor-skeleton-panel" />
              </div>
            }
          >
            <DocumentGenerator />
          </Suspense>
        </main>
      )}
    </div>
  );
}

export default App;
