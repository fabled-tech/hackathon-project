import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    name: 'RightsRadar',
    mode: 'demo',
    title: 'RightsRadar',
    description: 'Hackathon demo for film rights clearance research.'
  });
}
