/**
 * P01 登录页
 * - 产品 Logo 和名称
 * - 产品简介
 * - 账号/密码/登录按钮
 * - 演示账号提示（点击填充）
 * - 登录校验、登录成功进入工作台
 */
import { useState } from 'react';
import { Card, Form, Input, Button, Typography, Divider, App, Tag, Space } from 'antd';
import { ShieldCheck, FileSearch, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { DEMO_ACCOUNTS, DISCLAIMER, COLORS, ROLE_MAP } from '@/constants';

const { Title, Text, Paragraph } = Typography;

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const [form] = Form.useForm<LoginForm>();
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  const handleSubmit = async (values: LoginForm) => {
    try {
      await login(values.email, values.password);
      message.success('登录成功');
      navigate('/dashboard', { replace: true });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败，请重试');
    }
  };

  const fillAccount = (email: string, password: string) => {
    form.setFieldsValue({ email, password });
    setSelectedAccount(email);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        background: 'linear-gradient(135deg, #f0f5ff 0%, #e6f7ff 50%, #f5f7fa 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 左侧品牌介绍 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px 80px',
          maxWidth: 640,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.ai} 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 6px 16px rgba(22, 119, 255, 0.25)',
            }}
          >
            <ShieldCheck size={26} color="#fff" />
          </div>
          <div>
            <Title level={3} style={{ margin: 0, fontWeight: 700, color: COLORS.textPrimary }}>
              契审智控
            </Title>
            <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>
              AI 采购合同审核平台
            </Text>
          </div>
        </div>

        <Title level={2} style={{ fontWeight: 700, marginBottom: 16, lineHeight: 1.3 }}>
          让每一份采购合同
          <br />
          都经过<span style={{ color: COLORS.primary }}>智能审核</span>
        </Title>

        <Paragraph style={{ fontSize: 15, color: COLORS.textSecondary, lineHeight: 1.8, marginBottom: 32 }}>
          面向企业采购合同审核场景，融合规则引擎与大模型语义分析，完成合同字段抽取、风险识别、原文定位、修改建议与人工确认的完整闭环。
        </Paragraph>

        <Space direction="vertical" size={16}>
          {[
            { icon: <FileSearch size={18} color={COLORS.primary} />, title: '智能解析', desc: '自动抽取合同字段与结构' },
            { icon: <Sparkles size={18} color={COLORS.ai} />, title: 'AI 语义审核', desc: '识别 15+ 类采购合同风险' },
            { icon: <ShieldCheck size={18} color={COLORS.low} />, title: '原文定位', desc: '风险条款一键溯源，建议可追溯' },
          ].map((f) => (
            <div key={f.title} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                {f.icon}
              </div>
              <div>
                <Text strong style={{ display: 'block', fontSize: 14 }}>
                  {f.title}
                </Text>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{f.desc}</Text>
              </div>
            </div>
          ))}
        </Space>
      </div>

      {/* 右侧登录卡片 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Card
          style={{
            width: 420,
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
            border: `1px solid ${COLORS.border}`,
          }}
          styles={{ body: { padding: 32 } }}
        >
          <Title level={4} style={{ marginBottom: 4, fontWeight: 600 }}>
            欢迎登录
          </Title>
          <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>
            请使用演示账号登录体验完整审核流程
          </Text>

          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            autoComplete="off"
            style={{ marginTop: 24 }}
            requiredMark={false}
          >
            <Form.Item
              label="账号"
              name="email"
              rules={[
                { required: true, message: '请输入账号' },
                { type: 'email', message: '请输入正确的邮箱格式' },
              ]}
            >
              <Input size="large" placeholder="请输入邮箱账号" autoComplete="username" />
            </Form.Item>

            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password size="large" placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={loading}
              style={{ marginTop: 8, height: 44, fontWeight: 600 }}
            >
              登录
            </Button>
          </Form>

          <Divider style={{ margin: '20px 0', fontSize: 12, color: COLORS.textSecondary }}>
            演示账号（点击填充）
          </Divider>

          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {DEMO_ACCOUNTS.map((acc) => (
              <div
                key={acc.email}
                onClick={() => fillAccount(acc.email, acc.password)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${selectedAccount === acc.email ? COLORS.primary : COLORS.border}`,
                  background: selectedAccount === acc.email ? '#e6f4ff' : '#fafbfc',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: acc.avatarColor,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {acc.name.charAt(0)}
                  </div>
                  <div>
                    <Text strong style={{ fontSize: 13, display: 'block' }}>
                      {ROLE_MAP[acc.role].label}
                    </Text>
                    <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>
                      {acc.email} · {acc.department}
                    </Text>
                  </div>
                </div>
                <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                  密码 {acc.password}
                </Tag>
              </div>
            ))}
          </Space>

          <div
            style={{
              marginTop: 20,
              padding: '10px 12px',
              background: '#fffbe6',
              borderRadius: 6,
              border: '1px solid #ffe58f',
            }}
          >
            <Text style={{ fontSize: 11, color: '#874d00', lineHeight: 1.6 }}>{DISCLAIMER}</Text>
          </div>
        </Card>
      </div>
    </div>
  );
}
