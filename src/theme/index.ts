/**
 * AntD 主题配置（主色专业蓝 + AI 辅助青绿）
 */
import type { ThemeConfig } from 'antd';
import { COLORS } from '@/constants';

export const theme: ThemeConfig = {
  token: {
    colorPrimary: COLORS.primary,
    colorInfo: COLORS.primary,
    colorLink: COLORS.primary,
    colorBgLayout: COLORS.bg,
    colorBorder: COLORS.border,
    colorTextBase: COLORS.textPrimary,
    colorTextSecondary: COLORS.textSecondary,
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 6,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif",
    fontSize: 14,
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 28,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.04)',
    boxShadowSecondary: '0 2px 8px rgba(0, 0, 0, 0.06)',
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      headerHeight: 56,
      headerPadding: '0 24px',
      siderBg: '#ffffff',
      bodyBg: COLORS.bg,
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemSelectedBg: '#e6f4ff',
      itemSelectedColor: COLORS.primary,
      itemHeight: 44,
      iconSize: 16,
      activeBarHeight: 0,
      activeBarBorderWidth: 0,
    },
    Card: {
      borderRadiusLG: 10,
      headerBg: 'transparent',
      paddingLG: 20,
    },
    Table: {
      headerBg: '#fafbfc',
      headerColor: COLORS.textSecondary,
      rowHoverBg: '#f6faff',
      borderColor: COLORS.border,
    },
    Statistic: {
      contentFontSize: 28,
    },
  },
};
