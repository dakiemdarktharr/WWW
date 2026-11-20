import { ArrowUpRight, Check } from 'lucide-react';
import { useId, type CSSProperties, type PointerEvent } from 'react';
import './plan-banners.css';

export type PlanTier = 'free' | 'plus' | 'max';

type Props = {
  locale?: 'vi' | 'en';
  selected?: PlanTier | null;
  onSelect?: (tier: PlanTier) => void;
  hrefBase?: string;
  disabled?: boolean;
  trialAvailable?: boolean;
};

const tiers: PlanTier[] = ['free', 'plus', 'max'];
const names = { free: 'Free', plus: 'Plus', max: 'Max' };
const prices = { free: 0, plus: 2, max: 6 };

export function PlanBanners({
  locale = 'vi',
  selected,
  onSelect,
  hrefBase = '/billing',
  disabled = false,
  trialAvailable = true,
}: Props) {
  const en = locale === 'en';
  const id = useId();
  const move = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      '--plan-light-x',
      `${((event.clientX - bounds.left) / bounds.width) * 100}%`,
    );
    event.currentTarget.style.setProperty(
      '--plan-light-y',
      `${((event.clientY - bounds.top) / bounds.height) * 100}%`,
    );
  };
  return (
    <div className="plan-banners" aria-label={en ? 'Kivuno plans' : 'Các gói Kivuno'}>
      {tiers.map((tier, index) => {
        const action =
          tier === 'free'
            ? en
              ? 'Start free'
              : 'Dùng miễn phí'
            : trialAvailable
              ? '30 days trial'
              : en
                ? 'Choose plan'
                : 'Chọn gói';
        const perks =
          tier === 'free'
            ? [
                en ? '3 provider profiles' : '3 profile nhà cung cấp',
                en ? '3 people per group' : '3 người mỗi group',
              ]
            : tier === 'plus'
              ? [
                  en ? '10 provider profiles' : '10 profile nhà cung cấp',
                  en ? '10 people per group' : '10 người mỗi group',
                ]
              : [
                  en ? 'Unlimited provider profiles' : 'Không giới hạn profile',
                  en ? 'Unlimited group members' : 'Không giới hạn người trong group',
                ];
        const contents = (
          <>
            <span className="plan-banner-top">
              <span>0{index + 1}</span>
              <ArrowUpRight size={24} aria-hidden="true" />
            </span>
            <span className="plan-banner-name">{names[tier]}</span>
            <span className="plan-banner-price">
              <strong>{prices[tier]}</strong>
              <span>
                {tier === 'free' ? (
                  en ? (
                    'forever'
                  ) : (
                    'trọn đời'
                  )
                ) : (
                  <>
                    test USDC<span> / {en ? 'month' : 'tháng'}</span>
                  </>
                )}
              </span>
            </span>
            <span className="plan-banner-perks" id={`${id}-${tier}-perks`}>
              {perks.map((perk) => (
                <span key={perk}>
                  <Check size={16} aria-hidden="true" />
                  {perk}
                </span>
              ))}
              <span>
                <Check size={16} aria-hidden="true" />
                {en ? 'Shared Chat · Sade' : 'Chat chung · Sade'}
              </span>
            </span>
            <span className="plan-banner-bottom">
              <span>{action}</span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </span>
            {tier !== 'free' && (
              <span className="plan-banner-network">
                Avalanche Fuji · {en ? 'test network' : 'mạng thử nghiệm'}
              </span>
            )}
          </>
        );
        const shared = {
          className: `plan-banner plan-banner--${tier}${selected === tier ? ' is-selected' : ''}`,
          style: { '--plan-light-x': '50%', '--plan-light-y': '0%' } as CSSProperties,
          onPointerMove: tier === 'free' ? undefined : move,
          'aria-label': `${names[tier]} · ${prices[tier]} ${tier === 'free' ? (en ? 'free forever' : 'miễn phí trọn đời') : en ? 'test USDC per month' : 'test USDC mỗi tháng'} · ${action}`,
          'aria-describedby': `${id}-${tier}-perks`,
        };
        return onSelect ? (
          <button
            {...shared}
            key={tier}
            type="button"
            aria-pressed={selected === tier}
            disabled={disabled}
            onClick={() => onSelect(tier)}
          >
            {contents}
          </button>
        ) : (
          <a {...shared} key={tier} href={`${hrefBase}?plan=${tier}`}>
            {contents}
          </a>
        );
      })}
    </div>
  );
}
