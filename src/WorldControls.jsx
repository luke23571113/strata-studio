const groups = [
  {
    name: 'Terrain',
    controls: [
      { id: 'sea', label: 'Sea level', low: 'Dry', high: 'Ocean' },
      { id: 'mountains', label: 'Mountain height', low: 'Gentle', high: 'Alpine' },
      { id: 'continents', label: 'Continent size', low: 'Islands', high: 'Vast' },
      { id: 'roughness', label: 'Roughness', low: 'Soft', high: 'Rugged' },
    ],
  },
  {
    name: 'Climate',
    controls: [
      {
        id: 'temperature',
        label: 'Temperature',
        low: 'Cold',
        high: 'Hot',
        unit: '°F',
        description: 'Equatorial temperature at sea level.',
      },
      {
        id: 'humidity',
        label: 'Humidity',
        low: 'Arid',
        high: 'Humid',
        unit: '%',
        description: 'Simulated regional humidity.',
      },
    ],
  },
];

export default function WorldControls({ settings, onChange }) {
  return groups.map((group) => (
    <fieldset key={group.name} className="control-group">
      <legend>{group.name}</legend>
      {group.controls.map((control) => (
        <div key={control.id} className="slider-control">
          <div className="slider-heading">
            <label htmlFor={control.id}>{control.label}</label>
            <output htmlFor={control.id}>
              {settings[control.id]}
              {control.unit}
            </output>
          </div>
          <input
            id={control.id}
            type="range"
            min="0"
            max="100"
            step="1"
            value={settings[control.id]}
            aria-describedby={
              control.description ? `${control.id}-description` : undefined
            }
            aria-valuetext={`${settings[control.id]}${control.unit || ''}`}
            onChange={(event) => onChange(control.id, Number(event.target.value))}
          />
          <div className="range-labels" aria-hidden="true">
            <span>{control.low}</span>
            <span>{control.high}</span>
          </div>
          {control.description && (
            <p className="control-description" id={`${control.id}-description`}>
              {control.description}
            </p>
          )}
        </div>
      ))}
    </fieldset>
  ));
}
