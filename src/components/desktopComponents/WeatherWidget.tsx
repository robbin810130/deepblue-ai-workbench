import React, { useState, useEffect, useCallback } from 'react';
import { Sun, Cloud, CloudRain, MapPin, Search, X, Loader2 } from 'lucide-react';

const API_KEY = '69a4f02a8d5b4b6ca886c3bdb4b9b730'; // 使用参考项目中的 Key

interface WeatherData {
  temp: string;
  text: string;
  icon: string;
  windScale: string;
  windDir: string;
}

export const WeatherWidget: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState('上海');
  const [locationId, setLocationId] = useState('101020100'); // 默认上海
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const fetchWeather = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`https://devapi.qweather.com/v7/weather/now?location=${id}&key=${API_KEY}`);
      const data = await res.json();
      if (data.code === '200') {
        setWeather(data.now);
      }
    } catch (error) {
      console.error('Failed to fetch weather:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const searchCity = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`https://geoapi.qweather.com/v2/city/lookup?location=${searchQuery}&key=${API_KEY}`);
      const data = await res.json();
      if (data.code === '200') {
        setSearchResults(data.location);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Failed to search city:', error);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectCity = (item: any) => {
    setCity(item.name);
    setLocationId(item.id);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    fetchWeather(item.id);
    // 持久化存储用户选择的城市
    localStorage.setItem('weather_widget_city', JSON.stringify({ name: item.name, id: item.id }));
  };

  useEffect(() => {
    const saved = localStorage.getItem('weather_widget_city');
    if (saved) {
      const { name, id } = JSON.parse(saved);
      setCity(name);
      setLocationId(id);
      fetchWeather(id);
    } else {
      fetchWeather(locationId);
    }
  }, [fetchWeather, locationId]);

  const getWeatherIcon = (iconCode: string) => {
    // 简单映射常见天气
    const code = parseInt(iconCode);
    if (code === 100) return <Sun className="w-9 h-9 text-yellow-400 drop-shadow-md animate-pulse" />;
    if (code >= 101 && code <= 104) return <Cloud className="w-9 h-9 text-slate-300 drop-shadow-md" />;
    if (code >= 300 && code <= 399) return <CloudRain className="w-9 h-9 text-blue-400 drop-shadow-md" />;
    return <Cloud className="w-9 h-9 text-white drop-shadow-md" />;
  };

  return (
    <div className="w-full h-full relative group/weather">
      {loading && !weather ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
        </div>
      ) : weather && (
        <div className="w-full h-full flex items-center justify-between px-4 py-2 text-white select-none">
          <div className="flex flex-col justify-center">
            <button 
              onClick={() => setShowSearch(true)}
              className="text-xs font-semibold opacity-75 flex items-center gap-1 hover:opacity-100 transition-opacity"
            >
              <MapPin className="w-3 h-3 text-blue-300" /> {city}
            </button>
            <span className="text-3xl font-black mt-0.5 tracking-tight leading-none">{weather.temp}°</span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs font-medium opacity-90">{weather.text}</span>
              <span className="text-[10px] font-medium opacity-50 uppercase">{weather.windDir} {weather.windScale}级</span>
            </div>
          </div>
          
          <div className="flex flex-col items-center justify-center flex-shrink-0">
            {getWeatherIcon(weather.icon)}
            <span className="text-[9px] font-bold tracking-wider mt-1 bg-white/20 px-1.5 py-0.2 rounded-full uppercase">
              {parseInt(weather.temp) > 30 ? 'Hot' : parseInt(weather.temp) < 10 ? 'Cold' : 'Nice'}
            </span>
          </div>
        </div>
      )}

      {/* 搜索面板 */}
      {showSearch && (
        <div 
          onPointerDown={e => e.stopPropagation()}
          className="absolute inset-0 bg-slate-900/95 backdrop-blur-xl z-[20] p-2.5 flex flex-col animate-in fade-in zoom-in duration-200 rounded-2xl"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <div className="relative flex-1">
              <input 
                autoFocus
                type="text" 
                placeholder="搜索城市..." 
                className="w-full bg-white/10 border border-white/20 rounded-lg py-1 pl-7 pr-2 text-xs text-white outline-none focus:ring-2 ring-blue-500/50"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchCity()}
              />
              <Search className="w-3.5 h-3.5 text-white/40 absolute left-2 top-1.5" />
            </div>
            <button onClick={() => setShowSearch(false)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-3.5 h-3.5 text-white" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {searching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-white/20 animate-spin" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="grid gap-1">
                {searchResults.map(item => (
                  <button 
                    key={item.id}
                    onClick={() => handleSelectCity(item)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-sm transition-colors group/item"
                  >
                    <div className="text-white font-medium">{item.name}</div>
                    <div className="text-[10px] text-white/40">{item.adm1} · {item.adm2}</div>
                  </button>
                ))}
              </div>
            ) : searchQuery && !searching && (
              <div className="text-center py-8 text-white/30 text-xs italic">未找到匹配城市</div>
            )}
            {!searchQuery && (
              <div className="text-[10px] text-white/30 uppercase tracking-widest text-center mt-4">输入城市名称并按回车搜索</div>
            )}
          </div>
        </div>
      )}

      {/* 背景微光 */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none -z-10" />
    </div>
  );
};
