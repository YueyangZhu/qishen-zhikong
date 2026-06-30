/**
 * 全局布局
 * 左侧固定导航（220px）+ 顶部工具栏（56px）+ 主内容区
 * 含：Logo、菜单、角色切换、用户菜单、退出登录、AI 免责声明
 */
import { useEffect, useMemo, useState } from 'react';
import { Layout, Menu, Dropdown, Avatar, Typography, Tag, Tooltip, Button, App, type MenuProps } from 'antd';
import {
  LayoutDashboard,
  FileText,
  FilePlus2,
  Scale,
  FileBarChart,
  Shield,
  LogOut,
  ChevronDown,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { ROLE_MAP, DISCLAIMER, COLORS } from '@/constants';
import { resetDemoData } from '@/utils/storage';
import type { Role } from '@/types';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

interface MenuItem {
  key: string;
  label: React.ReactNode;
  icon: React.ReactNode;
}

function buildMenuItems(role: Role): MenuItem[] {
  const items: MenuItem[] = [
    { key: '/dashboard', label: <Link to="/dashboard">工作台</Link>, icon: <LayoutDashboard size={16} /> },
    { key: '/reviews', label: <Link to="/reviews">合同审核</Link>, icon: <FileText size={16} /> },
    { key: '/reports', label: <Link to="/reports">审核报告</Link>, icon: <FileBarChart size={16} /> },
  ];

  // 法务：菜单名"合同审核"变为"合同复核"
  if (role === 'legal') {
    items[1] = { key: '/reviews', label: <Link to="/reviews">合同复核</Link>, icon: <Scale size={16} /> };
  }

  if (role === 'legal' || role === 'admin') {
    items.push({ key: '/rules', label: <Link to="/rules">风险规则库</Link>, icon: <Shield size={16} /> });
  }

  if (role === 'purchaser') {
    items.splice(1, 0, {
      key: '/reviews/new',
      label: <Link to="/reviews/new">新建审核</Link>,
      icon: <FilePlus2 size={16} />,
    });
  }

  return items;
}

export default function MainLayout() {
  const { currentUser, logout, switchRole } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [collapsed, setCollapsed] = useState(false);

  const menuItems = useMemo(() => buildMenuItems(currentUser?.role ?? 'purchaser'), [currentUser?.role]);

  // 根据路由同步浏览器标签页标题
  useEffect(() => {
    const path = location.pathname;
    const titleMap: Record<string, string> = {
      '/dashboard': '工作台',
      '/reviews': '合同审核',
      '/reviews/new': '新建审核任务',
      '/reports': '审核报告',
      '/rules': '风险规则库',
    };
    let pageName = titleMap[path];
    if (!pageName) {
      if (path.startsWith('/reviews/new')) pageName = '新建审核任务';
      else if (path.match(/\/reviews\/[^/]+\/progress/)) pageName = '审核进度';
      else if (path.match(/\/reviews\/[^/]+\/fields/)) pageName = '字段确认';
      else if (path.match(/\/reviews\/[^/]+\/history/)) pageName = '审核记录';
      else if (path.match(/\/reviews\/[^/]+/)) pageName = '审核详情';
      else if (path.match(/\/legal-reviews\/[^/]+/)) pageName = '法务复核';
      else if (path.match(/\/reports\/[^/]+/)) pageName = '报告详情';
    }
    document.title = pageName ? `${pageName} | 契审智控` : '契审智控｜AI采购合同审核平台';
  }, [location.pathname]);

  // 选中当前菜单（取路径前缀，如 /reviews/xxx -> /reviews）
  const selectedKey = useMemo(() => {
    const p = location.pathname;
    if (p.startsWith('/reviews/new')) return '/reviews/new';
    if (p.startsWith('/reviews')) return '/reviews';
    if (p.startsWith('/reports')) return '/reports';
    if (p.startsWith('/rules')) return '/rules';
    if (p.startsWith('/legal-reviews')) return '/reviews';
    if (p.startsWith('/dashboard')) return '/dashboard';
    return p;
  }, [location.pathname]);

  const handleLogout = () => {
    modal.confirm({
      title: '退出登录',
      content: '确认退出当前账号？退出后需重新登录。',
      okText: '退出',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await logout();
        message.success('已退出登录');
        navigate('/login', { replace: true });
      },
    });
  };

  const handleReset = () => {
    modal.confirm({
      title: '重置演示数据',
      content: '将清空所有本地改动并恢复到初始演示数据，此操作不可恢复。',
      okText: '确认重置',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        resetDemoData();
        message.success('演示数据已重置，即将刷新页面...');
        setTimeout(() => window.location.reload(), 800);
      },
    });
  };

  const userMenu = {
    items: [
      {
        key: 'role',
        type: 'group' as const,
        label: '切换演示角色',
        children: (['purchaser', 'legal', 'admin'] as Role[]).map((r) => ({
          key: r,
          label: (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{ROLE_MAP[r].label}</span>
              {currentUser?.role === r && <Tag color="blue">当前</Tag>}
            </div>
          ),
          onClick: async () => {
            try {
              await switchRole(r);
              message.success(`已切换为：${ROLE_MAP[r].label}`);
              // 切换角色后刷新页面，确保所有请求使用新 token，避免旧 token 401
              setTimeout(() => window.location.assign('/dashboard'), 400);
            } catch (e) {
              message.error(e instanceof Error ? e.message : '切换角色失败');
            }
          },
        })),
      },
      { type: 'divider' as const },
      {
        key: 'reset',
        icon: <RefreshCw size={14} />,
        label: '重置演示数据',
        onClick: handleReset,
      },
      { type: 'divider' as const },
      {
        key: 'logout',
        icon: <LogOut size={14} />,
        label: '退出登录',
        onClick: handleLogout,
      },
    ],
  };

  if (!currentUser) return null;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        collapsedWidth={0}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        className="no-print"
        style={{ background: '#fff', borderRight: `1px solid ${COLORS.border}`, position: 'fixed', left: 0, top: 0, bottom: 0, overflow: 'auto' }}
      >
        <div style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 20px', borderBottom: `1px solid ${COLORS.border}` }}>
          <img src="/logo.svg" alt="logo" style={{ width: 28, height: 28, marginRight: 10, flexShrink: 0 }} />
          {!collapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPrimary }}>契审智控</span>
              <span style={{ fontSize: 11, color: COLORS.textSecondary }}>AI采购合同审核</span>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems as MenuProps['items']}
          style={{ borderRight: 0, marginTop: 8, padding: '0 8px' }}
        />
        {!collapsed && (
          <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12, padding: '10px 12px', background: '#f6faff', borderRadius: 6, border: `1px solid #d6e4ff` }}>
            <Text style={{ fontSize: 11, color: COLORS.textSecondary, lineHeight: 1.5 }}>{DISCLAIMER}</Text>
          </div>
        )}
      </Sider>

      <Layout className="main-layout-body" style={{ marginLeft: collapsed ? 0 : 220, transition: 'margin-left 0.2s', background: COLORS.bg }}>
        <Header
          className="no-print"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: `1px solid ${COLORS.border}`,
            padding: '0 24px',
            height: 56,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Tooltip title={collapsed ? '展开侧边栏' : '收起侧边栏'}>
              <Button
                type="text"
                size="small"
                icon={collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                onClick={() => setCollapsed(!collapsed)}
              />
            </Tooltip>
            <Tooltip title="AI 辅助审核">
              <Tag color="cyan" style={{ margin: 0, borderRadius: 4, padding: '2px 8px' }}>
                <span style={{ color: COLORS.ai, fontWeight: 600 }}>AI 辅助</span>
              </Tag>
            </Tooltip>
            <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>
              {ROLE_MAP[currentUser.role].desc}
            </Text>
          </div>

          <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
            <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
              <Avatar size={28} style={{ background: currentUser.avatarColor, color: '#fff' }}>
                {currentUser.name.charAt(0)}
              </Avatar>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                <Text style={{ fontSize: 13, fontWeight: 600 }}>{currentUser.name}</Text>
                <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>
                  {ROLE_MAP[currentUser.role].label}
                </Text>
              </div>
              <ChevronDown size={14} color={COLORS.textSecondary} />
            </Button>
          </Dropdown>
        </Header>

        <Content style={{ padding: 20, minHeight: 'calc(100vh - 56px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
