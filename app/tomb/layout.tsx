import type { Viewport } from "next";

/**
 * 古墓剧本杀使用 1:1 视口。
 *
 * 站点根布局为了兼容桌面像素 UI 设置了 initialScale=0.5，在手机上会把布局视口
 * 撑到设备宽度的两倍（390px 的手机变成 780px），导致移动端断点失效、触屏摇杆被隐藏。
 * 这里为 /tomb 单独覆盖成 1:1，3D 场景与 HUD 才能按真实手机尺寸排布。
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#07060c",
};

export default function TombLayout({ children }: { children: React.ReactNode }) {
  return children;
}
