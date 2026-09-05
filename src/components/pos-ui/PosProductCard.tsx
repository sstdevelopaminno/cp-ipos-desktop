type Props = {
  title: string;
  price: number;
  subtitle?: string;
  imageUrl?: string;
  badge?: string;
  recommended?: boolean;
  disabled?: boolean;
  onAdd: () => void;
};

function formatPrice(value: number): string {
  return Number.isInteger(value) ? `฿${value}` : `฿${value.toFixed(2)}`;
}

export function PosProductCard({ title, price, subtitle, imageUrl, badge, recommended = false, disabled = false, onAdd }: Props) {
  return (
    <button type="button" className={`posui-product-card ${disabled ? "is-disabled" : ""}`} onClick={onAdd} disabled={disabled}>
      <div className="posui-product-card__image" style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined} aria-hidden>
        {!imageUrl ? <span>{title.slice(0, 1).toUpperCase()}</span> : null}
      </div>
      <div className="posui-product-card__body">
        <p className="posui-product-card__title">{title}</p>
        {recommended ? <p className="posui-product-card__recommend">แนะนำ</p> : null}
        {subtitle ? <p className="posui-product-card__subtitle">{subtitle}</p> : null}
        {badge ? <p className={`posui-product-card__badge ${disabled ? "is-danger" : ""}`}>{badge}</p> : null}
        <p className="posui-product-card__price">{formatPrice(price)}</p>
      </div>
    </button>
  );
}
