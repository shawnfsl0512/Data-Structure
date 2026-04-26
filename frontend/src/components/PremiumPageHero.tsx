import React from 'react';
import { Card, Col, Row, Space, Statistic, Tag, Typography } from 'antd';

const { Title, Paragraph } = Typography;

export type HeroMetric = {
  label: string;
  value: string | number;
  suffix?: React.ReactNode;
};

type PremiumPageHeroProps = {
  title: string;
  description: string;
  tags?: string[];
  metrics?: HeroMetric[];
  sideContent?: React.ReactNode;
  actions?: React.ReactNode;
  accent?: 'blue' | 'amber' | 'teal';
  eyebrow?: string;
  coverImageUrl?: string;
  coverLabel?: string;
};

const accentBackgroundMap: Record<NonNullable<PremiumPageHeroProps['accent']>, string> = {
  blue: 'linear-gradient(135deg, rgba(95,73,237,0.98), rgba(119,97,248,0.94) 42%, rgba(129,140,248,0.88) 100%)',
  amber:
    'linear-gradient(135deg, rgba(245,124,54,0.98), rgba(251,146,60,0.94) 40%, rgba(251,191,36,0.88) 100%)',
  teal: 'linear-gradient(135deg, rgba(13,148,136,0.98), rgba(20,184,166,0.92) 42%, rgba(34,197,94,0.86) 100%)',
};

const PremiumPageHero: React.FC<PremiumPageHeroProps> = ({
  title,
  description,
  tags = [],
  metrics = [],
  sideContent,
  actions,
  accent = 'blue',
  eyebrow,
  coverImageUrl,
  coverLabel,
}) => {
  return (
    <Card
      variant="borderless"
      style={{
        marginBottom: 18,
        borderRadius: 28,
        background: accentBackgroundMap[accent],
        boxShadow: '0 24px 54px rgba(15,23,42,0.14)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(560px 220px at 0% 0%, rgba(255,255,255,0.18), transparent 56%), radial-gradient(420px 240px at 100% 0%, rgba(255,255,255,0.12), transparent 48%)',
          pointerEvents: 'none',
        }}
      />
      <Row gutter={[20, 20]} align="middle">
        <Col xs={24} lg={coverImageUrl ? 15 : sideContent || metrics.length > 0 ? 14 : 24}>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <div>
              {eyebrow ? (
                <div
                  style={{
                    marginBottom: 10,
                    display: 'inline-flex',
                    padding: '6px 12px',
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.16)',
                    color: 'rgba(255,255,255,0.88)',
                    fontSize: 12,
                    letterSpacing: 0.4,
                  }}
                >
                  {eyebrow}
                </div>
              ) : null}
              <Title level={2} style={{ margin: 0 }}>
                <span style={{ color: '#ffffff' }}>{title}</span>
              </Title>
              <Paragraph style={{ margin: '10px 0 0', color: 'rgba(255,255,255,0.82)', maxWidth: 720 }}>
                {description}
              </Paragraph>
            </div>
            {tags.length > 0 ? (
              <Space wrap>
                {tags.map((tag) => (
                  <Tag
                    key={tag}
                    style={{
                      color: '#ffffff',
                      borderColor: 'rgba(255,255,255,0.2)',
                      background: 'rgba(255,255,255,0.10)',
                      borderRadius: 999,
                      paddingInline: 12,
                    }}
                  >
                    {tag}
                  </Tag>
                ))}
              </Space>
            ) : null}
            {actions ? <div>{actions}</div> : null}
          </Space>
        </Col>

        {coverImageUrl ? (
          <Col xs={24} lg={9}>
            <div
              style={{
                minHeight: 220,
                borderRadius: 24,
                backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.08), rgba(15,23,42,0.30)), url(${coverImageUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                border: '1px solid rgba(255,255,255,0.18)',
                boxShadow: '0 20px 48px rgba(15,23,42,0.18)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {coverLabel ? (
                <div
                  style={{
                    position: 'absolute',
                    right: 16,
                    top: 16,
                    padding: '6px 10px',
                    borderRadius: 999,
                    background: 'rgba(15,23,42,0.55)',
                    color: '#ffffff',
                    fontSize: 12,
                  }}
                >
                  {coverLabel}
                </div>
              ) : null}
            </div>
          </Col>
        ) : sideContent ? (
          <Col xs={24} lg={10}>
            {sideContent}
          </Col>
        ) : metrics.length > 0 ? (
          <Col xs={24} lg={10}>
            <Row gutter={[12, 12]}>
              {metrics.map((metric) => (
                <Col xs={12} key={metric.label}>
                  <Card
                    size="small"
                    variant="borderless"
                    style={{
                      borderRadius: 16,
                      height: '100%',
                      background: 'rgba(255,255,255,0.14)',
                      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
                    }}
                  >
                    <Statistic
                      title={<span style={{ color: 'rgba(255,255,255,0.72)' }}>{metric.label}</span>}
                      value={metric.value}
                      suffix={metric.suffix}
                      valueStyle={{ color: '#ffffff' }}
                    />
                  </Card>
                </Col>
              ))}
            </Row>
          </Col>
        ) : null}
      </Row>
    </Card>
  );
};

export default PremiumPageHero;
