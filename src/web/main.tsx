import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import Layout from "./components/Layout.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Providers from "./pages/Providers.tsx";
import ProviderDetail from "./pages/ProviderDetail.tsx";
import Bans from "./pages/Bans.tsx";
import Operators from "./pages/Operators.tsx";
import Rotation from "./pages/Rotation.tsx";
import "./styles.css";

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <Layout />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: "providers", element: <Providers /> },
        { path: "providers/:id", element: <ProviderDetail /> },
        { path: "rotation", element: <Rotation /> },
        { path: "bans", element: <Bans /> },
        { path: "operators", element: <Operators /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" },
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
