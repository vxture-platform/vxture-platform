/**
 * StatsSection.tsx
 *
 * 功能：
 * - 首页核心数据统计区块，展示企业关键指标与动画效果
 * - 支持吸附滚动、卡片动画、响应式布局
 *
 * 用途：
 * - 作为首页核心数据展示区，提升品牌信任与专业形象
 * - 结构与其它 Section 组件保持一致，便于团队协作
 *
 * 依赖/调用关系：
 * - 依赖 TailwindCSS、Next.js、@vxture/design-system
 * - 被 app/(main)/page.tsx 直接引用
 *
 * 设计规范：
 * - 只负责 UI 展示与交互，不包含业务逻辑
 * - 命名、结构、注释与其它 Section 组件保持一致
 *
 * @file StatsSection.tsx
 * @desc 首页核心数据统计区块，动画丰富，响应式
 * @author vxture team
 * @created 2024-06-01
 * @lastModified 2025-10-15
 * @modifiedBy stonesmoker
 * @copyright Copyright (c) 2024-2025 vxture
 * @version 1.0.0
 * @dependencies React, TailwindCSS, @vxture/design-system
 * @tags home, stats, section, component
 * @example
 *   <StatsSection />
 * @remarks
 *   仅负责 UI 展示，业务逻辑请移至上层页面/服务。
 * @todo
 *   支持更多动态数据与动画效果
 */
"use client";

// 引入 React 的 hooks
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

// 引入图标
import { Icon } from "@vxture/design-system";

export default function StatsSection() {
  // 监听当前 section 是否处于吸附状态
  const sectionRef = useRef(null);

  // 控制动画是否触发（进入视口时）
  const [inView, setInView] = useState(false);

  // 统计数据列表，每个对象代表一个卡片
  const stats = [
    {
      number: 10,
      suffix: "+",
      label: "企业客户",
      description: "服务政府、国央企等多个大客户",
      icon: (
        <Icon name="building-library" className="w-16 h-16 text-vx-brand-400" />
      ),
      color: "from-vx-brand-400 to-vx-info-400", // Tailwind 渐变色
    },
    {
      number: 50,
      suffix: "+",
      label: "智能化项目",
      description: "成功交付数据智能平台和应用",
      icon: <Icon name="cube" className="w-16 h-16 text-vx-brand-400" />,
      color: "from-vx-brand-400 to-vx-info-400",
    },
    {
      number: 98.0,
      suffix: "%",
      label: "客户满意度",
      description: "客户续约率持续保持行业领先",
      icon: <Icon name="star" className="w-16 h-16 text-vx-brand-400" />,
      color: "from-vx-brand-400 to-vx-info-400",
    },
    {
      number: 2000,
      suffix: "+",
      label: "业务用户",
      description: "在线业务用户规模持续增长",
      icon: <Icon name="users" className="w-16 h-16 text-vx-brand-400" />,
      color: "from-vx-brand-400 to-vx-info-400",
    },
  ];

  /**
   * 进入视口时触发动画
   * 使用 IntersectionObserver 监听组件是否进入视口
   */
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && entry.isIntersecting) {
          setInView(true); // 进入视口，触发动画
        }
      },
      { threshold: 0.3 }, // 30% 可见时触发
    );

    const element = document.getElementById("stats-section");
    if (element) {
      observer.observe(element);
    }

    // 清理 observer
    return () => {
      if (element) {
        observer.unobserve(element);
      }
    };
  }, []);

  /**
   * 数字动画组件
   * @param value 目标数字
   * @param suffix 单位后缀
   * @param duration 动画时长（毫秒）
   */
  const AnimatedNumber = ({
    value,
    suffix,
    duration = 2000,
  }: {
    value: number;
    suffix: string;
    duration?: number;
  }) => {
    // 当前显示的数字
    const [displayValue, setDisplayValue] = useState(0);

    useEffect(() => {
      if (!inView) return; // 未进入视口不动画

      let startTime: number;
      let animationFrame: number;

      // 动画函数
      const animate = (currentTime: number) => {
        if (!startTime) startTime = currentTime;
        const progress = Math.min((currentTime - startTime) / duration, 1);

        // 四次缓出函数，动画更平滑
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        setDisplayValue(value * easeOutQuart);

        if (progress < 1) {
          animationFrame = requestAnimationFrame(animate);
        }
      };

      animationFrame = requestAnimationFrame(animate);

      // 清理动画帧
      return () => {
        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
        }
      };
    }, [value, duration]);

    // 格式化数字显示
    const formatNumber = (num: number) => {
      if (suffix === "%") {
        return num.toFixed(1); // 百分比保留一位小数
      }
      if (suffix === "PB+") {
        return Math.floor(num); // PB+取整
      }
      return Math.floor(num); // 其他取整
    };

    return (
      <span className="tabular-nums">
        {formatNumber(displayValue)}
        {suffix}
      </span>
    );
  };

  return (
    <section
      ref={sectionRef}
      id="snapTarget-5"
      aria-label="公司核心数据统计"
      className={`relative snap-section h-screen pt-28 bg-linear-to-br from-vx-brand-100 to-vx-white dark:from-vx-gray-800 dark:to-vx-gray-700`}
    >
      {/* 背景装饰圆形（z-0，放在内容容器后面，仅限section内定位） */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-vx-brand-100/10 dark:bg-vx-brand-900/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-vx-info-100/10 dark:bg-vx-brand-900/10 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-150 h-150 bg-linear-to-r from-vx-brand-100/5 to-vx-info-100/5 rounded-full blur-3xl"></div>
      </div>

      {/* 内容容器（z-10） */}
      <div className="relative z-10 h-full max-w-7xl xl:max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section title */}
        <div className="flex items-center justify-between mb-16">
          {/* Section title and subtitle */}
          <div className="flex-1 text-center">
            <h2 className="font-display text-3xl lg:text-4xl font-bold text-vx-brand-700 dark:text-vx-brand-200 mb-6">
              服务的客户
            </h2>
            <p className="text-lg text-vx-gray-500 dark:text-vx-gray-300 max-w-website-4xl mx-auto">
              用数字见证我们在数据智能领域的专业实力与客户信赖
            </p>
          </div>
        </div>
        {/* 统计卡片网格 */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              // 卡片动画：进入视口时 slide-in-from-bottom，未进入时透明
              className={`relative group ${inView ? "animate-in slide-in-from-bottom-8 duration-700" : "opacity-0"}`}
              style={{ animationDelay: `${index * 150}ms` }} // 瀑布式动画延迟
            >
              {/* 卡片主体 */}
              <div className="relative pb-8 bg-vx-white/80 dark:bg-vx-gray-600/60 backdrop-blur-sm border border-vx-brand-100 dark:border-vx-gray-500 rounded-2xl transition-all duration-500 hover:shadow-2xl hover:border-vx-brand-400 dark:hover:border-vx-brand-400 hover:scale-105 overflow-hidden">
                {/* 渐变边框效果，hover 时显现, 用伪元素实现渐变边框 */}

                <div
                  className={`absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 bg-linear-to-r ${stat.color}`} // 关键：使用 -z-10 将其置于底层
                >
                  <div className="h-full w-full rounded-2xl bg-transparent"></div>
                </div>

                <div className="relative z-10">
                  {/* 图标 */}
                  <div className="flex justify-center">
                    <div className="w-24 h-24 flex items-center justify-center transition-transform duration-300">
                      {stat.icon}
                    </div>
                  </div>

                  {/* 动画数字 */}
                  <div
                    className={`text-4xl lg:text-5xl font-bold text-center mb-3 bg-linear-to-r ${stat.color} bg-clip-text text-transparent`}
                  >
                    <AnimatedNumber value={stat.number} suffix={stat.suffix} />
                  </div>

                  {/* 标签 */}
                  <h3 className="text-xl font-semibold text-vx-brand-700 dark:text-vx-brand-200 text-center mb-3">
                    {stat.label}
                  </h3>

                  {/* 描述 */}
                  <p className="text-vx-gray-600 dark:text-vx-gray-300 text-center text-base leading-relaxed">
                    {stat.description}
                  </p>
                </div>

                {/* 装饰圆形，hover 时增强透明度 */}
                <div
                  className={`absolute -top-2 -right-2 w-20 h-20 bg-linear-to-r ${stat.color} rounded-full opacity-10 group-hover:opacity-40 transition-opacity duration-500`}
                ></div>
              </div>
            </div>
          ))}
        </div>
        {/* 底部装饰文本，样式与 FeaturesSection 完全一致 */}
        <div className="text-center my-16">
          <div className="inline-flex items-center space-x-2 text-vx-gray-500 dark:text-vx-gray-300">
            <div className="w-8 h-px bg-linear-to-r from-transparent to-vx-gray-300 dark:to-vx-gray-600"></div>
            <span className="text-sm font-medium">持续创新，共创数字未来</span>
            <div className="w-8 h-px bg-linear-to-l from-transparent to-vx-gray-300 dark:to-vx-gray-600"></div>
          </div>
        </div>
        {/* 客户logo展示区域，两行五列布局 */}
        <div className="my-8 grid grid-cols-5 gap-x-24 gap-y-8">
          {/* 只渲染磁盘上真实存在的客户 logo（当前 2 张）——原来硬写 10 个，
           * 8 个 404 后靠 onError 换占位块，控制台整版加载错误。补图后把
           * 数量改回去即可。 */}
          {Array.from({ length: 2 }).map((_, idx) => {
            const num = String(idx + 1).padStart(2, "0");
            const src = `/images/customers/customer-logo-${num}.webp`;
            return (
              <div
                key={num}
                className="flex items-center justify-center h-12 rounded-lg"
              >
                <Image
                  src={src}
                  alt={`客户Logo${num}`}
                  width={80}
                  height={80}
                  className="w-full h-full object-fill rounded-lg"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    if (e.currentTarget.parentElement) {
                      e.currentTarget.parentElement.innerHTML = `<span class='flex items-center justify-center w-full h-full bg-vx-brand-200 dark:bg-vx-gray-700 text-vx-gray-400 text-xs rounded-lg'>客户Logo${num}</span>`;
                    }
                  }}
                  unoptimized
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
